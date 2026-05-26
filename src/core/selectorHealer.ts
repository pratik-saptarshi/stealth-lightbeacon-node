import * as cheerio from 'cheerio';

export interface SelectorHealResult {
  healed: boolean;
  recoveredText: string;
  suggestedSelector: string;
  confidence: number;
}

export function levenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

export function similarityScore(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  if (len === 0) return 1.0;
  return (len - levenshteinDistance(a, b)) / len;
}

export class SelectorHealer {
  /**
   * Attempts to heal a selector failure by scanning the HTML for elements matching text or attributes.
   */
  public static heal(
    html: string,
    failedSelector: string,
    options: {
      expectedText?: string;
      expectedTagName?: string;
      expectedClasses?: string[];
      threshold?: number;
    } = {}
  ): SelectorHealResult {
    const $ = cheerio.load(html);
    const threshold = options.threshold ?? 0.8;

    // Check if the selector actually matches first
    const directMatch = $(failedSelector);
    if (directMatch.length > 0) {
      return {
        healed: false,
        recoveredText: directMatch.text().trim(),
        suggestedSelector: failedSelector,
        confidence: 1.0
      };
    }

    const tagName = (options.expectedTagName ?? failedSelector.split(/[.#[:\s]/)[0]) || '*';
    const candidates = $(tagName).toArray();
    let bestCandidate: any = null;
    let maxScore = 0;

    for (const el of candidates) {
      const $el = $(el);
      let score = 0;
      let weightSum = 0;

      // 1. Text Similarity Weight
      if (options.expectedText) {
        const text = $el.text().trim();
        const textScore = similarityScore(text, options.expectedText);
        score += textScore * 2.0; // Higher weight for text content matches
        weightSum += 2.0;
      }

      // 2. Class List Similarity Weight
      if (options.expectedClasses && options.expectedClasses.length > 0) {
        const classes = ($el.attr('class') || '').split(/\s+/).filter(Boolean);
        const matchCount = options.expectedClasses.filter(c => classes.includes(c)).length;
        const classScore = matchCount / options.expectedClasses.length;
        score += classScore * 1.0;
        weightSum += 1.0;
      }

      // Calculate weighted score
      const finalScore = weightSum > 0 ? score / weightSum : 0;
      if (finalScore > maxScore && finalScore >= threshold) {
        maxScore = finalScore;
        bestCandidate = el;
      }
    }

    if (bestCandidate) {
      const $best = $(bestCandidate);
      // Construct a clean, unique selector suggestion
      const id = $best.attr('id');
      const tag = bestCandidate.tagName;
      let suggestedSelector = tag;
      if (id) {
        suggestedSelector = `#${id}`;
      } else {
        const classes = ($best.attr('class') || '').split(/\s+/).filter(Boolean);
        if (classes.length > 0) {
          suggestedSelector = `${tag}.${classes.join('.')}`;
        }
      }

      return {
        healed: true,
        recoveredText: $best.text().trim(),
        suggestedSelector,
        confidence: maxScore
      };
    }

    return {
      healed: false,
      recoveredText: '',
      suggestedSelector: failedSelector,
      confidence: 0
    };
  }
}
