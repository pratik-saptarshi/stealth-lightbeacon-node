import { AeoEvaluator } from '../evaluators/aeo';
import { AccessibilityEvaluator } from '../evaluators/accessibility';
import { DrupalSecurityEvaluator } from '../evaluators/drupalSecurity';
import { GeoEvaluator } from '../evaluators/geo';
import { PerformanceEvaluator } from '../evaluators/performance';
import { SeoEvaluator } from '../evaluators/seo';
import { UxEvaluator } from '../evaluators/ux';
import type { Evaluator } from './types';

export function createDefaultEvaluators(): Evaluator[] {
  return [
    new PerformanceEvaluator(),
    new SeoEvaluator(),
    new AeoEvaluator(),
    new GeoEvaluator(),
    new AccessibilityEvaluator(),
    new UxEvaluator(),
    new DrupalSecurityEvaluator()
  ];
}
