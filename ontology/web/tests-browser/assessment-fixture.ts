import * as C from '../src/contracts.js';

export function assessmentRecords(scope: string, ref: (id: number) => C.Ref, provenance: C.Provenance): C.GraphRecord[] {
  const applicability = new C.Applicability_Declared('Only this controlled fixture', [], []);
  const condition = new C.Definition(ref(140), scope, applicability, new C.Content_Statement('Condition account', C.Modality.Assertion), C.Standing.Active, [], undefined, provenance);
  const task = new C.Definition(ref(141), scope, applicability, new C.Content_Task('Controlled conditional work', new C.Acceptance(['Observable outcome'], undefined), C.Execution.Delegated), C.Standing.Active, [], undefined, provenance);
  const conditionBinding = new C.Binding(ref(142), scope, condition.ref, [], 'assessment-fixture', provenance);
  const requirement = new C.Relation(ref(143), scope, applicability, C.RelationKind.Requires, [task.ref], [conditionBinding.ref], new C.RelationDetail_Empty(), 'Required condition', C.Standing.Active, provenance);
  const consumer = new C.Binding(ref(144), scope, task.ref, [requirement.ref], 'assessment-fixture', provenance);
  const selectCondition = new C.BindingSelection(ref(145), scope, conditionBinding.ref, true, 'Fixture condition contract', [condition.ref], provenance);
  const selectConsumer = new C.BindingSelection(ref(146), scope, consumer.ref, true, 'Fixture consumer contract', [task.ref], provenance);
  const review = new C.Definition(ref(147), scope, applicability, new C.Content_Review('Controlled assessment', ['Supported within the fixture'], [conditionBinding.ref], [condition.ref], 'Not independent verification', C.Assessment.Supported), C.Standing.Active, [condition.ref], undefined, provenance);
  const assessment = new C.Relation(ref(148), scope, applicability, C.RelationKind.Assesses, [review.ref], [conditionBinding.ref], new C.RelationDetail_Empty(), 'Exact assessed subject', C.Standing.Active, provenance);
  const use = new C.Relation(ref(149), scope, applicability, C.RelationKind.UsesAssessment, [assessment.ref], [consumer.ref], new C.RelationDetail_AssessmentUse(requirement.ref, C.AssessmentUseDisposition.Applicable, [condition.ref]), 'Declared fixture applicability use', C.Standing.Active, provenance);
  const basis = new C.GateBasis([condition.ref, conditionBinding.ref, requirement.ref, consumer.ref, review.ref, assessment.ref, use.ref], [selectCondition.ref, selectConsumer.ref]);
  const event = new C.StateEvent(ref(150), scope, consumer.ref, undefined, C.Phase.Active, undefined, undefined, [], 'Reported work in a synthetic fixture', basis, provenance);
  return [new C.GraphRecord_Node(condition), new C.GraphRecord_Node(task), new C.GraphRecord_Contract(conditionBinding), new C.GraphRecord_Edge(requirement), new C.GraphRecord_Contract(consumer), new C.GraphRecord_Selection(selectCondition), new C.GraphRecord_Selection(selectConsumer), new C.GraphRecord_Node(review), new C.GraphRecord_Edge(assessment), new C.GraphRecord_Edge(use), new C.GraphRecord_Progress(event)];
}
