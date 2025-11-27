// --- tests/utils.test.ts ---

import { getCleanIPv4, isPrivateIP } from "@src/utils";

// Mock config to prevent side effects on import
jest.mock("@src/config", () => ({
    PORT: 8080,
    MAX_LOG_BUFFER_SIZE: 100,
}));

describe("Utils Unit Tests", () => {
    describe("getCleanIPv4", () => {
        test("should return standard IPv4 as is", () => {
            expect(getCleanIPv4("192.168.1.1")).toBe("192.168.1.1");
        });

        test("should clean IPv6 mapped IPv4", () => {
            expect(getCleanIPv4("::ffff:192.168.1.1")).toBe("192.168.1.1");
        });

        test("should handle localhost IPv6", () => {
            expect(getCleanIPv4("::1")).toBe("127.0.0.1");
        });

        test('should return "unknown" for invalid/empty input', () => {
            expect(getCleanIPv4(undefined)).toBe("unknown");
            expect(getCleanIPv4()).toBe("unknown");
        });
    });

    describe("isPrivateIP", () => {
        test("should identify 192.168.x.x as private", () => {
            expect(isPrivateIP("192.168.0.1")).toBeTruthy();
        });

        test("should identify 10.x.x.x as private", () => {
            expect(isPrivateIP("10.0.0.5")).toBeTruthy();
        });

        test("should identify 172.16.x.x range as private", () => {
            expect(isPrivateIP("172.16.0.1")).toBeTruthy();
            expect(isPrivateIP("172.31.255.255")).toBeTruthy();
        });

        test("should identify public IPs as not private", () => {
            expect(isPrivateIP("8.8.8.8")).toBeFalsy();
            expect(isPrivateIP("1.1.1.1")).toBeFalsy();
        });

        test("should return false for undefined input", () => {
            expect(isPrivateIP(undefined)).toBe(false);
        });
    });
});