import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "../../../catalogs/2026-03-20-v1.1-phase1/manifest.json";
import progression from "../../../catalogs/2026-03-20-v1.1-phase1/progression.json";
import operators from "../../../catalogs/2026-03-20-v1.1-phase1/operators.json";
import facilities from "../../../catalogs/2026-03-20-v1.1-phase1/facilities.json";
import recipes from "../../../catalogs/2026-03-20-v1.1-phase1/recipes.json";
import sources from "../../../catalogs/2026-03-20-v1.1-phase1/sources.json";
import gaps from "../../../catalogs/2026-03-20-v1.1-phase1/gaps.json";
import assets from "../../../catalogs/2026-03-20-v1.1-phase1/assets.json";

import { App } from "./App";

const responses = new Map<string, unknown>([
  ["/catalogs/2026-03-20-v1.1-phase1/manifest.json", manifest],
  ["/catalogs/2026-03-20-v1.1-phase1/progression.json", progression],
  ["/catalogs/2026-03-20-v1.1-phase1/operators.json", operators],
  ["/catalogs/2026-03-20-v1.1-phase1/facilities.json", facilities],
  ["/catalogs/2026-03-20-v1.1-phase1/recipes.json", recipes],
  ["/catalogs/2026-03-20-v1.1-phase1/sources.json", sources],
  ["/catalogs/2026-03-20-v1.1-phase1/gaps.json", gaps],
  ["/catalogs/2026-03-20-v1.1-phase1/assets.json", assets],
]);

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const key = String(input);
        const body = responses.get(key);
        if (!body) {
          return new Response("not found", { status: 404 });
        }
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
  });

  it("loads the bundled catalog and runs optimize from the UI", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const ownedToggles = await screen.findAllByRole("checkbox", { name: "Owned" });
    await userEvent.click(ownedToggles[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));

    await waitFor(() => {
      expect(screen.getByText("Why this wins")).toBeInTheDocument();
      expect(screen.getByText(/Total score/i)).toBeInTheDocument();
    });
  });
});
