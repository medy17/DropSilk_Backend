const { matchRoute } = require("../src/routeMatcher");

describe("routeMatcher", () => {
    test("matches static routes", () => {
        expect(matchRoute("POST", "/api/rooms", "POST", "/api/rooms")).toEqual({});
    });

    test("extracts path params", () => {
        expect(
            matchRoute(
                "POST",
                "/api/rooms/ABC123/participants/user-1/ready",
                "POST",
                "/api/rooms/:roomCode/participants/:participantId/ready"
            )
        ).toEqual({
            roomCode: "ABC123",
            participantId: "user-1",
        });
    });

    test("returns null for method mismatch", () => {
        expect(matchRoute("GET", "/api/rooms", "POST", "/api/rooms")).toBeNull();
    });

    test("returns null for shape mismatch", () => {
        expect(
            matchRoute(
                "POST",
                "/api/rooms/ABC123/participants/user-1",
                "POST",
                "/api/rooms/:roomCode/participants/:participantId/ready"
            )
        ).toBeNull();
    });
});
