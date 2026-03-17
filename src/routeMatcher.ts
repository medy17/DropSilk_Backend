export type RouteParams = Record<string, string>;

export function matchRoute(
    method: string | undefined,
    actualPath: string,
    expectedMethod: string,
    pattern: string
): RouteParams | null {
    if ((method || "GET").toUpperCase() !== expectedMethod.toUpperCase()) {
        return null;
    }

    const actualSegments = actualPath.split("/").filter(Boolean);
    const patternSegments = pattern.split("/").filter(Boolean);

    if (actualSegments.length !== patternSegments.length) {
        return null;
    }

    const params: RouteParams = {};

    for (let index = 0; index < patternSegments.length; index++) {
        const actualSegment = actualSegments[index];
        const patternSegment = patternSegments[index];

        if (patternSegment.startsWith(":")) {
            params[patternSegment.slice(1)] = decodeURIComponent(actualSegment);
            continue;
        }

        if (patternSegment !== actualSegment) {
            return null;
        }
    }

    return params;
}
