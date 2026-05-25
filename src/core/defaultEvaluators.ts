import type { Evaluator } from './types';
import { createDefaultEvaluatorRegistry, type EvaluatorPluginMetadata } from './evaluatorRegistry';

export function createDefaultEvaluators(): Evaluator[] {
  return createDefaultEvaluatorRegistry().createEvaluators();
}

export function listDefaultEvaluatorPlugins(): EvaluatorPluginMetadata[] {
  return createDefaultEvaluatorRegistry().list();
}
