"""Conditional decision quality; no transport, resource counters or ground-truth I/O."""
from dataclasses import dataclass
import math
from clef_decisions import Probability

THRESHOLDS = (.50,.60,.70,.80,.90,.95,.99)
RELIABILITY_BINS = 10
TASK_LABELS = (
    ('node_kind',('task','constraint','claim','observation','hypothesis','unknown')),
    ('edge_kind',('supports','challenges','none','unknown')),
    ('source_support',('entails','contradicts','insufficient')),
)

@dataclass(frozen=True)
class Reference:
    question_id: str
    acceptable: tuple[str,...]

@dataclass(frozen=True)
class Prediction:
    question_id: str
    case_id: str
    family: str
    partition: str
    task: str
    label: str | None
    probabilities: tuple[Probability,...] | None
    availability: str

@dataclass(frozen=True)
class ClassMetric:
    label: str
    tp: int
    fp: int
    fn: int
    precision: float | None
    recall: float | None
    f1: float | None

@dataclass(frozen=True)
class QualitySummary:
    task: str
    partition: str
    roster: int
    available: int
    unavailable: int
    acceptable_set_correct: int
    correct_roster_fraction: float | None
    correct_available_fraction: float | None
    ambiguous_gold: int
    critical_errors: int
    singleton_confusion: tuple[tuple[str,str,int],...]
    class_metrics_singleton_gold: tuple[ClassMetric,...]
    macro_f1_defined_classes_singleton: float | None

@dataclass(frozen=True)
class ReliabilityBin:
    index: int
    count: int
    mean_confidence: float | None
    accuracy: float | None

@dataclass(frozen=True)
class CalibrationSummary:
    singleton_probability_rows: int
    excluded_ambiguous_rows: int
    excluded_unavailable_or_no_probability_rows: int
    multiclass_brier_sum_over_labels_mean: float | None
    nll_mean: float | None
    zero_true_probability_rows: int
    nll_infinite: bool
    equal_width_10_bin_ece: float | None
    bins: tuple[ReliabilityBin,...]

@dataclass(frozen=True)
class Policy:
    task: str
    threshold: float | None
    calibration_roster: int
    calibration_accepted: int
    calibration_errors: int
    calibration_critical_errors: int
    kind: str


def ratio(numerator,denominator):
    return numerator/denominator if denominator else None


def labels(task):
    for name,values in TASK_LABELS:
        if task==name:return values
    raise ValueError('unknown-task')


def validate_availability(row):
    if type(row.availability) is not str or not row.availability.strip():raise ValueError('availability-state')
    if row.availability=='valid':
        if row.label is None:raise ValueError('availability-label-missing')
    elif row.label is not None or row.probabilities is not None:
        raise ValueError('availability-failure-with-prediction')


def validate(rows,references):
    if len({r.question_id for r in rows})!=len(rows) or len({r.question_id for r in references})!=len(references):
        raise ValueError('duplicate-question')
    by_id={r.question_id:r for r in references}
    if set(by_id)!={r.question_id for r in rows}:raise ValueError('reference-coverage')
    for r in rows:
        validate_availability(r)
        allowed=labels(r.task);reference=by_id[r.question_id]
        if not reference.acceptable or len(set(reference.acceptable))!=len(reference.acceptable) or not set(reference.acceptable)<=set(allowed):raise ValueError('reference-label')
        if r.label is not None and r.label not in allowed:raise ValueError('prediction-label')
        if r.probabilities is not None:
            values={p.option:p.value for p in r.probabilities}
            if len(values)!=len(r.probabilities) or set(values)!=set(allowed) or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in values.values()) or abs(math.fsum(values.values())-1)>1e-6:raise ValueError('prediction-probabilities')
            if r.label is not None and values[r.label]!=max(values.values()):raise ValueError('prediction-not-argmax')
    return by_id


def critical(task,acceptable,prediction):
    if prediction is None or prediction in acceptable:return False
    if task=='node_kind':
        return (prediction=='task' and 'constraint' in acceptable) or (prediction=='observation' and bool(set(acceptable)&{'claim','hypothesis','unknown'}))
    if task=='edge_kind':return prediction=='supports' and bool(set(acceptable)&{'challenges','none','unknown'})
    if task=='source_support':return prediction=='entails' and bool(set(acceptable)&{'contradicts','insufficient'})
    raise ValueError('unknown-task')


def summarize(rows,references,task,partition):
    by_id=validate(rows,references)
    selected=[r for r in rows if r.task==task and r.partition==partition]
    available=[r for r in selected if r.label is not None]
    correct=sum(r.label in by_id[r.question_id].acceptable for r in available)
    ambiguous=sum(len(by_id[r.question_id].acceptable)>1 for r in selected)
    single=[r for r in selected if len(by_id[r.question_id].acceptable)==1]
    metrics=[];confusion=[]
    for gold in labels(task):
        for predicted in (*labels(task),'__unavailable__'):
            count=sum(by_id[r.question_id].acceptable[0]==gold and (r.label if r.label is not None else '__unavailable__')==predicted for r in single)
            if count:confusion.append((gold,predicted,count))
        tp=sum(by_id[r.question_id].acceptable[0]==gold and r.label==gold for r in single)
        fp=sum(by_id[r.question_id].acceptable[0]!=gold and r.label==gold for r in single)
        fn=sum(by_id[r.question_id].acceptable[0]==gold and r.label!=gold for r in single)
        metrics.append(ClassMetric(gold,tp,fp,fn,ratio(tp,tp+fp),ratio(tp,tp+fn),ratio(2*tp,2*tp+fp+fn)))
    defined=[m.f1 for m in metrics if m.f1 is not None]
    return QualitySummary(task,partition,len(selected),len(available),len(selected)-len(available),correct,ratio(correct,len(selected)),ratio(correct,len(available)),ambiguous,sum(critical(task,by_id[r.question_id].acceptable,r.label) for r in selected),tuple(confusion),tuple(metrics),ratio(math.fsum(defined),len(defined)))


def calibration(rows,references):
    by_id=validate(rows,references);brier=[];nll=[];zero=0;ambiguous=0;unavailable=0;bins=[[] for _ in range(RELIABILITY_BINS)]
    for row in rows:
        reference=by_id[row.question_id]
        if len(reference.acceptable)>1:ambiguous+=1;continue
        if row.label is None or row.probabilities is None:unavailable+=1;continue
        values={p.option:p.value for p in row.probabilities};gold=reference.acceptable[0]
        brier.append(math.fsum((p-float(key==gold))**2 for key,p in values.items()))
        if values[gold]==0:zero+=1
        else:nll.append(-math.log(values[gold]))
        confidence=max(values.values());index=min(RELIABILITY_BINS-1,int(confidence*RELIABILITY_BINS));bins[index].append((confidence,float(row.label==gold)))
    result=[];weighted=0
    for index,values in enumerate(bins):
        count=len(values);confidence=ratio(math.fsum(p for p,_ in values),count);accuracy=ratio(math.fsum(y for _,y in values),count)
        if count:weighted+=count*abs(confidence-accuracy)
        result.append(ReliabilityBin(index,count,confidence,accuracy))
    return CalibrationSummary(len(brier),ambiguous,unavailable,ratio(math.fsum(brier),len(brier)),None if zero else ratio(math.fsum(nll),len(nll)),zero,bool(zero),ratio(weighted,len(brier)),tuple(result))


def accepts(row,threshold):
    validate_availability(row)
    if threshold is None or row.label is None or row.probabilities is None or row.label in ('unknown','insufficient'):return False
    return max(p.value for p in row.probabilities)>=threshold


def select_policy(rows,references,task):
    by_id=validate(rows,references);selected=[r for r in rows if r.task==task and r.partition=='calibration'];candidates=[]
    for threshold in THRESHOLDS:
        accepted=[r for r in selected if accepts(r,threshold)]
        errors=sum(r.label not in by_id[r.question_id].acceptable for r in accepted)
        severe=sum(critical(task,by_id[r.question_id].acceptable,r.label) for r in accepted)
        if accepted and severe==0:candidates.append((len(accepted),threshold,errors,severe))
    if not candidates:return Policy(task,None,len(selected),0,0,0,'zero-observed-critical-calibration-heuristic-not-guaranteed-risk')
    count,threshold,errors,severe=max(candidates,key=lambda row:(row[0],row[1]))
    return Policy(task,threshold,len(selected),count,errors,severe,'zero-observed-critical-calibration-heuristic-not-guaranteed-risk')


def simulated_route(native,baseline,policies):
    native_ids={r.question_id for r in native};baseline_ids={r.question_id for r in baseline}
    if len(native_ids)!=len(native) or len(baseline_ids)!=len(baseline) or native_ids!=baseline_ids:raise ValueError('paired-coverage')
    fallback={r.question_id:r for r in baseline};thresholds={p.task:p.threshold for p in policies};out=[];accepted=[]
    for row in native:
        other=fallback[row.question_id];validate_availability(other)
        if (row.case_id,row.family,row.partition,row.task)!=(other.case_id,other.family,other.partition,other.task):raise ValueError('paired-binding')
        if accepts(row,thresholds[row.task]):out.append(row);accepted.append(row.question_id)
        else:out.append(fallback[row.question_id])
    return tuple(out),tuple(accepted)
