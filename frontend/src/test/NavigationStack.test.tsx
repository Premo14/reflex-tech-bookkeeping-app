import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { NavigationStackProvider } from "@/context/NavigationStackProvider";
import { useNavigationStack } from "@/context/navigationStackContext";

function TestNavigationConsumer() {
  const nav = useNavigationStack();

  return (
    <div>
      <div data-testid="current-view">{nav.current ? nav.current.type : "none"}</div>
      <div data-testid="stack-depth">{nav.stack.length}</div>
      <div data-testid="is-reports-open">{String(nav.isOpen("reports"))}</div>
      <div data-testid="is-reports-suspended">{String(nav.isSuspended("reports"))}</div>
      <div data-testid="is-drawer-open">{String(nav.isOpen("drawer"))}</div>
      <div data-testid="is-drawer-suspended">{String(nav.isSuspended("drawer"))}</div>
      <div data-testid="is-settings-open">{String(nav.isOpen("settings"))}</div>

      <button onClick={() => nav.push("reports", { tab: "ar_aging" })}>
        Open Reports
      </button>
      <button onClick={() => nav.push("invoicing")}>Open Invoicing</button>
      <button onClick={() => nav.push("drawer", { drawerType: "invoice", id: 101 })}>
        Open Invoice Drawer
      </button>
      <button onClick={() => nav.push("settings", { tab: "rules" })}>
        Open Settings Rules
      </button>
      <button onClick={() => nav.push("review", { statusType: "PENDING" })}>
        Open Review
      </button>
      <button onClick={() => nav.pop()}>Go Back</button>
      <button onClick={() => nav.closeAll()}>Close All</button>
    </div>
  );
}

describe("NavigationStackContext & History Navigation", () => {
  it("pushes, suspends, and restores views accurately (Flow: reports -> drawer -> back to reports)", async () => {
    const user = userEvent.setup();
    render(
      <NavigationStackProvider>
        <TestNavigationConsumer />
      </NavigationStackProvider>
    );

    // Initial state: on ledger, no modal open
    expect(screen.getByTestId("current-view")).toHaveTextContent("none");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("0");

    // 1. User opens Reports modal
    await user.click(screen.getByRole("button", { name: "Open Reports" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("reports");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("1");
    expect(screen.getByTestId("is-reports-open")).toHaveTextContent("true");
    expect(screen.getByTestId("is-reports-suspended")).toHaveTextContent("false");

    // 2. In Reports (A/R Aging), user clicks "View" on invoice -> opens DetailDrawer
    await user.click(screen.getByRole("button", { name: "Open Invoice Drawer" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("drawer");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("2");
    // Reports is now suspended underneath the drawer!
    expect(screen.getByTestId("is-reports-open")).toHaveTextContent("true");
    expect(screen.getByTestId("is-reports-suspended")).toHaveTextContent("true");
    expect(screen.getByTestId("is-drawer-open")).toHaveTextContent("true");
    expect(screen.getByTestId("is-drawer-suspended")).toHaveTextContent("false");

    // 3. User closes DetailDrawer (click X / Go Back)
    await user.click(screen.getByRole("button", { name: "Go Back" }));
    // Automatically returns user to ReportsModal where they were last!
    expect(screen.getByTestId("current-view")).toHaveTextContent("reports");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("1");
    expect(screen.getByTestId("is-reports-open")).toHaveTextContent("true");
    expect(screen.getByTestId("is-reports-suspended")).toHaveTextContent("false");
    expect(screen.getByTestId("is-drawer-open")).toHaveTextContent("false");

    // 4. User closes ReportsModal
    await user.click(screen.getByRole("button", { name: "Go Back" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("none");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("0");
    expect(screen.getByTestId("is-reports-open")).toHaveTextContent("false");
  });

  it("handles multi-level nesting: review -> drawer -> settings -> back to drawer -> back to review -> back to ledger", async () => {
    const user = userEvent.setup();
    render(
      <NavigationStackProvider>
        <TestNavigationConsumer />
      </NavigationStackProvider>
    );

    // 1. Open Review
    await user.click(screen.getByRole("button", { name: "Open Review" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("review");

    // 2. Open item drawer
    await user.click(screen.getByRole("button", { name: "Open Invoice Drawer" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("drawer");

    // 3. From drawer, click Create Rule (opens Settings rules tab)
    await user.click(screen.getByRole("button", { name: "Open Settings Rules" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("settings");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("3");
    expect(screen.getByTestId("is-drawer-suspended")).toHaveTextContent("true");

    // 4. Exit Settings -> returns to drawer
    await user.click(screen.getByRole("button", { name: "Go Back" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("drawer");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("2");
    expect(screen.getByTestId("is-drawer-suspended")).toHaveTextContent("false");

    // 5. Exit Drawer -> returns to review queue
    await user.click(screen.getByRole("button", { name: "Go Back" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("review");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("1");

    // 6. Exit Review -> returns to ledger grid
    await user.click(screen.getByRole("button", { name: "Go Back" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent("none");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("0");
  });

  it("provides safe fallback defaults outside of NavigationStackProvider", () => {
    // When used outside provider, no exceptions thrown and safe empty values returned
    render(<TestNavigationConsumer />);
    expect(screen.getByTestId("current-view")).toHaveTextContent("none");
    expect(screen.getByTestId("stack-depth")).toHaveTextContent("0");
    expect(screen.getByTestId("is-reports-open")).toHaveTextContent("false");
    expect(screen.getByTestId("is-reports-suspended")).toHaveTextContent("false");
  });
});
