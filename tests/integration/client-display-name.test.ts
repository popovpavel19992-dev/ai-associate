import { describe, it, expect } from "vitest";
import { deriveDisplayName } from "@/lib/clients";

describe("deriveDisplayName", () => {
  it("joins firstName + lastName for individuals", () => {
    expect(
      deriveDisplayName({ clientType: "individual", firstName: "Jane", lastName: "Doe" }),
    ).toBe("Jane Doe");
  });

  it("trims surrounding whitespace for individuals", () => {
    expect(
      deriveDisplayName({ clientType: "individual", firstName: "  Jane ", lastName: " Doe " }),
    ).toBe("Jane Doe");
  });

  it("collapses missing first name for individuals", () => {
    expect(
      deriveDisplayName({ clientType: "individual", firstName: "", lastName: "Doe" }),
    ).toBe("Doe");
  });

  it("uses companyName for organizations", () => {
    expect(
      deriveDisplayName({ clientType: "organization", companyName: "Acme Corp" }),
    ).toBe("Acme Corp");
  });

  it("trims companyName", () => {
    expect(
      deriveDisplayName({ clientType: "organization", companyName: "  Acme Corp  " }),
    ).toBe("Acme Corp");
  });
});
