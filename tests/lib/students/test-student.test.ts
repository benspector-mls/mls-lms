/**
 * The three strings a test student is made of, and the question that says a profile is one.
 *
 * Each of these is derived from the number rather than stored, so getting one wrong is not a
 * failure anybody reads as such: a display name is only a label, but the handle is the suffix of
 * every repository a test student accepts, and the address is what makes the account unreachable —
 * `.invalid` is reserved by RFC 2606, so no sign-in link for one can ever be delivered.
 *
 * These came out of `scripts/verify-test-student.ts`, where they needed no database at all.
 * Everything that script held about the database is in `tests/integration/test-student.test.ts`.
 */
import {
  isTestStudent,
  nextTestStudentNumber,
  testStudentEmail,
  testStudentHandle,
  testStudentName,
} from "@/lib/students/test-student";

describe("the strings derived from the number", () => {
  it("the display name is the number", () => {
    expect(testStudentName(3)).toBe("Test Student 3");
  });

  it("the handle is the number", () => {
    expect(testStudentHandle(3)).toBe("test-student-3");
  });

  it("the address is unreachable by design", () => {
    expect(testStudentEmail(3)).toBe("test-student-3@test.invalid");
  });
});

/*
  The column is the whole of what makes a profile a test student, and `enroll` and `remove` refuse
  on this answer — so the pair below is the difference between those procedures and a mutation that
  enrols anybody and deletes anybody's account.
*/
describe("whether a profile is a test student", () => {
  it("a null number is not a test student", () => {
    expect(isTestStudent({ testStudentNumber: null })).toBe(false);
  });

  it("a number is", () => {
    expect(isTestStudent({ testStudentNumber: 1 })).toBe(true);
  });
});

describe("the next test student's number", () => {
  it("starts at one when no test student has ever existed", () => {
    expect(nextTestStudentNumber(null, [])).toBe(1);
  });

  it("follows the highest number still on a profile", () => {
    expect(nextTestStudentNumber(2, [{ number: 1 }, { number: 2 }])).toBe(3);
  });

  it("does not reuse the number of a test student that was removed", () => {
    // Test Student 3 was created and then removed, so the highest live profile is 2.
    expect(nextTestStudentNumber(2, [{ number: 3 }, { number: 3 }])).toBe(4);
  });

  it("does not reuse a number when every test student has been removed", () => {
    expect(nextTestStudentNumber(null, [{ number: 5 }])).toBe(6);
  });

  it("counts a profile made before the audit log existed", () => {
    expect(nextTestStudentNumber(7, [{ number: 4 }])).toBe(8);
  });

  it("skips an event whose detail holds no whole-number number", () => {
    expect(
      nextTestStudentNumber(1, [null, "9", [9], {}, { number: "9" }, { number: 9.5 }]),
    ).toBe(2);
  });
});
