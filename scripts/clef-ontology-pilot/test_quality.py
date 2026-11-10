"""Known synthetic metric oracles only; no authored benchmark labels or predictions."""
import math
from dataclasses import replace
import unittest
from clef_decisions import Probability
from quality import (Prediction,Reference,accepts,calibration,critical,labels,
                     select_policy,simulated_route,summarize,validate)


def row(key,task,partition,label,probabilities):
    return Prediction(key,key,'synthetic-family',partition,task,label,probabilities,'valid' if label is not None else 'unavailable')


def edge_prob(support,challenges,none,unknown):
    return tuple(Probability(k,v) for k,v in zip(labels('edge_kind'),(support,challenges,none,unknown)))


class QualityTests(unittest.TestCase):
    def test_unavailable_keeps_roster_denominator(self):
        rows=(row('a','edge_kind','test','supports',None),row('b','edge_kind','test',None,None));refs=(Reference('a',('supports',)),Reference('b',('challenges',)))
        result=summarize(rows,refs,'edge_kind','test');self.assertEqual((result.roster,result.available,result.unavailable),(2,1,1));self.assertEqual(result.correct_roster_fraction,.5);self.assertEqual(result.correct_available_fraction,1.);self.assertIn(('challenges','__unavailable__',1),result.singleton_confusion)
    def test_empty_denominator_is_undefined(self):
        result=summarize((),(),'edge_kind','test');self.assertIsNone(result.correct_roster_fraction);self.assertIsNone(result.correct_available_fraction);self.assertIsNone(result.macro_f1_defined_classes_singleton)
    def test_ambiguous_set_correct_not_forced_into_confusion(self):
        rows=(row('a','node_kind','test','claim',None),);refs=(Reference('a',('claim','observation')),);result=summarize(rows,refs,'node_kind','test');self.assertEqual(result.acceptable_set_correct,1);self.assertEqual(result.ambiguous_gold,1);self.assertEqual(result.singleton_confusion,());self.assertIsNone(result.macro_f1_defined_classes_singleton)
    def test_calibration_multiclass_brier_nll_and_ece(self):
        rows=(row('a','edge_kind','test','supports',edge_prob(.8,.2,0.,0.)),);refs=(Reference('a',('supports',)),);result=calibration(rows,refs);self.assertAlmostEqual(result.multiclass_brier_sum_over_labels_mean,.08);self.assertAlmostEqual(result.nll_mean,-math.log(.8));self.assertAlmostEqual(result.equal_width_10_bin_ece,.2);self.assertEqual(result.bins[8].count,1)
    def test_zero_probability_nll_is_explicit_infinite_not_clipped(self):
        rows=(row('a','edge_kind','test','supports',edge_prob(1.,0.,0.,0.)),);refs=(Reference('a',('challenges',)),);result=calibration(rows,refs);self.assertTrue(result.nll_infinite);self.assertEqual(result.zero_true_probability_rows,1);self.assertIsNone(result.nll_mean)
    def test_calibration_exclusions_have_explicit_counts(self):
        rows=(row('a','edge_kind','test','supports',edge_prob(1.,0.,0.,0.)),row('b','edge_kind','test','supports',None));refs=(Reference('a',('supports','none')),Reference('b',('supports',)));result=calibration(rows,refs);self.assertEqual(result.excluded_ambiguous_rows,1);self.assertEqual(result.excluded_unavailable_or_no_probability_rows,1);self.assertEqual(result.singleton_probability_rows,0);self.assertIsNone(result.multiclass_brier_sum_over_labels_mean)
    def test_critical_only_wrong_strengthening_and_unknown_not_missing(self):
        self.assertTrue(critical('node_kind',('constraint',),'task'));self.assertTrue(critical('node_kind',('claim',),'observation'));self.assertFalse(critical('node_kind',('claim','observation'),'observation'));self.assertFalse(critical('node_kind',('constraint',),None));self.assertTrue(critical('source_support',('insufficient',),'entails'))
    def test_threshold_uses_calibration_only_and_ties_choose_higher(self):
        rows=(row('a','edge_kind','calibration','supports',edge_prob(.9,.1,0.,0.)),row('b','edge_kind','calibration','supports',edge_prob(.6,.4,0.,0.)),row('c','edge_kind','test','supports',edge_prob(.99,.01,0.,0.)));refs=(Reference('a',('supports',)),Reference('b',('challenges',)),Reference('c',('challenges',)));policy=select_policy(rows,refs,'edge_kind');self.assertEqual(policy.threshold,.9);self.assertEqual(policy.calibration_roster,2);self.assertEqual(policy.calibration_accepted,1);self.assertTrue(accepts(rows[2],policy.threshold))
    def test_no_useful_zero_critical_coverage_defers_all(self):
        rows=(row('a','edge_kind','calibration','supports',edge_prob(1.,0.,0.,0.)),);refs=(Reference('a',('challenges',)),);policy=select_policy(rows,refs,'edge_kind');self.assertIsNone(policy.threshold);self.assertEqual(policy.calibration_accepted,0);self.assertFalse(accepts(rows[0],policy.threshold))
    def test_semantic_unknown_always_defers_even_with_high_probability(self):
        r=row('a','edge_kind','calibration','unknown',edge_prob(0.,0.,0.,1.));self.assertFalse(accepts(r,.5))
    def test_duplicate_or_missing_reference_is_rejected(self):
        rows=(row('a','edge_kind','test','supports',None),)
        with self.assertRaisesRegex(ValueError,'reference-coverage'):validate(rows,())
        with self.assertRaisesRegex(ValueError,'duplicate-question'):validate(rows*2,(Reference('a',('supports',)),))
    def test_nonwinning_prediction_or_bool_probability_rejected(self):
        with self.assertRaisesRegex(ValueError,'prediction-not-argmax'):validate((row('a','edge_kind','test','challenges',edge_prob(.8,.2,0.,0.)),),(Reference('a',('supports',)),))
        with self.assertRaisesRegex(ValueError,'prediction-probabilities'):validate((row('a','edge_kind','test','supports',edge_prob(True,0.,0.,0.)),),(Reference('a',('supports',)),))
    def test_failed_operational_row_cannot_carry_accepted_labels(self):
        r=replace(row('a','edge_kind','calibration','supports',edge_prob(1.,0.,0.,0.)),availability='unavailable')
        with self.assertRaisesRegex(ValueError,'availability'):validate((r,),(Reference('a',('supports',)),))
        with self.assertRaisesRegex(ValueError,'availability'):accepts(r,.99)
    def test_simulated_pairing_rejects_duplicate_ids(self):
        r=row('a','edge_kind','calibration','supports',edge_prob(1.,0.,0.,0.));baseline=row('a','edge_kind','calibration','supports',None);policy=select_policy((r,),(Reference('a',('supports',)),),'edge_kind')
        with self.assertRaisesRegex(ValueError,'paired-coverage'):simulated_route((r,r),(baseline,),(policy,))
    def test_simulated_pairing_cannot_change_binding_metadata(self):
        r=row('a','edge_kind','calibration','supports',edge_prob(1.,0.,0.,0.));baseline=replace(row('a','edge_kind','calibration','supports',None),partition='test');policy=select_policy((r,),(Reference('a',('supports',)),),'edge_kind')
        with self.assertRaisesRegex(ValueError,'paired-binding'):simulated_route((r,),(baseline,),(policy,))
    def test_simulated_fallback_is_label_estimate_not_call_savings(self):
        native=(row('a','edge_kind','calibration','supports',edge_prob(.9,.1,0.,0.)),row('b','edge_kind','test','unknown',edge_prob(0.,0.,0.,1.)));baseline=(row('a','edge_kind','calibration','supports',None),row('b','edge_kind','test','challenges',None));refs=(Reference('a',('supports',)),Reference('b',('challenges',)));policy=select_policy(native,refs,'edge_kind');routed,accepted=simulated_route(native,baseline,(policy,));self.assertEqual(accepted,('a',));self.assertEqual(routed[1],baseline[1])

if __name__=='__main__':unittest.main()
