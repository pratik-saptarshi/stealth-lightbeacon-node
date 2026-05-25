import { AeoEvaluator } from '../evaluators/aeo';
import { AccessibilityEvaluator } from '../evaluators/accessibility';
import { DrupalSecurityEvaluator } from '../evaluators/drupalSecurity';
import { GeoEvaluator } from '../evaluators/geo';
import { PerformanceEvaluator } from '../evaluators/performance';
import { SeoEvaluator } from '../evaluators/seo';
import { UxEvaluator } from '../evaluators/ux';
import type { Evaluator } from './types';

export interface EvaluatorPluginDefinition {
  id: string;
  domain: string;
  description: string;
  prerequisites: string[];
  order: number;
  create: () => Evaluator;
}

export interface EvaluatorPluginMetadata {
  id: string;
  domain: string;
  description: string;
  prerequisites: string[];
  order: number;
}

export class EvaluatorRegistry {
  private readonly plugins = new Map<string, EvaluatorPluginDefinition>();

  register(definition: EvaluatorPluginDefinition): void {
    if (this.plugins.has(definition.id)) {
      throw new Error(`Duplicate evaluator plugin id: ${definition.id}`);
    }
    this.plugins.set(definition.id, definition);
  }

  list(): EvaluatorPluginMetadata[] {
    return this.sorted().map((plugin) => ({
      id: plugin.id,
      domain: plugin.domain,
      description: plugin.description,
      prerequisites: [...plugin.prerequisites],
      order: plugin.order
    }));
  }

  createEvaluators(): Evaluator[] {
    return this.sorted().map((plugin) => plugin.create());
  }

  private sorted(): EvaluatorPluginDefinition[] {
    return [...this.plugins.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
}

export function createDefaultEvaluatorRegistry(): EvaluatorRegistry {
  const registry = new EvaluatorRegistry();

  registry.register({
    id: 'performance',
    domain: 'Performance',
    description: 'Evaluates Core Web Vitals and baseline page performance signals.',
    prerequisites: ['pagespeed'],
    order: 10,
    create: () => new PerformanceEvaluator()
  });
  registry.register({
    id: 'seo',
    domain: 'SEO',
    description: 'Validates crawlability, metadata, canonicalization, and search visibility signals.',
    prerequisites: [],
    order: 20,
    create: () => new SeoEvaluator()
  });
  registry.register({
    id: 'aeo',
    domain: 'AEO',
    description: 'Checks answer-engine metadata and concise answer structure.',
    prerequisites: [],
    order: 30,
    create: () => new AeoEvaluator()
  });
  registry.register({
    id: 'geo',
    domain: 'GEO',
    description: 'Evaluates authority, recency, and geographic trust indicators.',
    prerequisites: [],
    order: 40,
    create: () => new GeoEvaluator()
  });
  registry.register({
    id: 'accessibility',
    domain: 'Accessibility',
    description: 'Detects accessibility issues including semantics, labels, and interaction affordances.',
    prerequisites: [],
    order: 50,
    create: () => new AccessibilityEvaluator()
  });
  registry.register({
    id: 'ux',
    domain: 'UX',
    description: 'Assesses readability, viewport readiness, and interaction ergonomics.',
    prerequisites: [],
    order: 60,
    create: () => new UxEvaluator()
  });
  registry.register({
    id: 'drupal-security',
    domain: 'Drupal Security',
    description: 'Finds Drupal-specific exposure and hardening gaps.',
    prerequisites: ['auxiliaryResponses.jsonApiUser'],
    order: 70,
    create: () => new DrupalSecurityEvaluator()
  });

  return registry;
}
