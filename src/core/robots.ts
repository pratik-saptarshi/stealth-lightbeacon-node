import createRobotsParser from 'robots-parser';

export class RobotsPolicy {
  private readonly parser: ReturnType<typeof createRobotsParser>;

  constructor(robotsUrl: string, content: string) {
    this.parser = createRobotsParser(robotsUrl, content);
  }

  isAllowed(userAgent: string, targetUrl: string): boolean {
    return this.parser.isAllowed(targetUrl, userAgent) ?? true;
  }

  getSitemaps(): string[] {
    return this.parser.getSitemaps();
  }
}
