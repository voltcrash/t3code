import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type PullRequestDetailView,
  type PullRequestDiffResult,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

const { diffAtom, pagedDiffAtom, omittedDiffAtom } = await vi.hoisted(async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const filePatch = (path: string) =>
    [
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,6 +1,6 @@",
      "-before()",
      "+after()",
      " one()",
      " two()",
      " three()",
      " four()",
      " five()",
      "",
    ].join("\n");
  const firstPage: PullRequestDiffResult = {
    patch: filePatch("a.ts"),
    truncated: false,
    nextCursor: null,
  };
  const pages: Record<string, PullRequestDiffResult> = {
    first: {
      patch: Array.from({ length: 40 }, (_, index) => filePatch(`early-${index}.ts`)).join(""),
      truncated: true,
      nextCursor: "page-2",
    },
    "page-2": { patch: filePatch("late.ts"), truncated: false, nextCursor: null },
  };
  return {
    // An environment query whose refetch returns equal content hands back the previous value
    // itself, so a refresh publishes a new result around the very same page.
    diffAtom: Atom.make(() => AsyncResult.success(firstPage)),
    omittedDiffAtom: Atom.make(() =>
      AsyncResult.success({
        patch:
          "diff --git a/example.cs b/example.cs\nnew file mode 100644\n--- /dev/null\n+++ b/example.cs\n",
        truncated: true,
        nextCursor: null,
        omittedFileStats: [{ path: "example.cs", additions: 0, deletions: 0 }],
      } satisfies PullRequestDiffResult),
    ),
    pagedDiffAtom: Atom.family((cursor: string) =>
      Atom.make(() => AsyncResult.success(pages[cursor]!)),
    ),
  };
});

const mocks = vi.hoisted(() => ({
  paged: false,
  omitted: false,
  diffCommits: [] as Array<string | undefined>,
  contents: vi.fn(),
}));

vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => mocks.contents) as never,
}));
vi.mock(import("~/state/pullRequests"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    pullRequestEnvironment: {
      ...actual.pullRequestEnvironment,
      diff: (({ input }: { input: { cursor?: string; commit?: string } }) => {
        mocks.diffCommits.push(input.commit);
        return mocks.omitted
          ? omittedDiffAtom
          : mocks.paged
            ? pagedDiffAtom(input.cursor ?? "first")
            : diffAtom;
      }) as never,
    },
  };
});

import { render } from "../../../test/render";
import PullRequestCodeTab from "./PullRequestCodeTab";

const detail: PullRequestDetailView = {
  provider: SourceControlProviderKind.make("github"),
  projectId: ProjectId.make("project"),
  projectTitle: "Project",
  workspaceRoot: "/workspace",
  repository: "owner/repo",
  number: 1,
  title: "Test pull request",
  body: "",
  url: "https://github.com/owner/repo/pull/1",
  author: { login: "author", name: null, avatarUrl: null },
  viewer: "author",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  headBranch: "feature",
  baseBranch: "main",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [],
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
  mergeCapabilities: { merge: false, squash: false, rebase: false },
  capabilities: {
    diff: true,
    comment: false,
    search: true,
    actions: [],
    mergeMethods: [],
    review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
    reviewers: { request: false, listCandidates: false },
    edit: { changeRequest: false, comment: false },
  },
  viewerPermissions: {
    actions: [],
    comment: false,
    resolve: false,
    verdicts: [],
    requestReviewers: false,
  },
};

function setup({ paged }: { paged: boolean }) {
  mocks.paged = paged;
  mocks.omitted = false;
  mocks.contents.mockReset();
  mocks.diffCommits = [];
}

const tab = (
  refreshToken: number,
  revealRequest: { readonly path: string; readonly nonce: number } | null = null,
) => (
  <PullRequestCodeTab
    scrollerRef={() => {}}
    environmentId={EnvironmentId.make("environment")}
    reference={detail}
    detail={detail}
    selectedCommitOid={null}
    onSelectedCommitChange={() => {}}
    onRefresh={() => {}}
    refreshToken={refreshToken}
    revealRequest={revealRequest}
  />
);

it("keeps the diff after a refresh that brings back the same page", async () => {
  setup({ paged: false });
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(tab(0), { container });
  await expect.element(screen.getByText("1 file", { exact: true })).toBeVisible();

  await screen.rerender(tab(1));

  await expect
    .element(screen.getByText("This pull request has no file changes."))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText("1 file", { exact: true })).toBeVisible();
});

function pagedContainer() {
  const container = document.createElement("div");
  container.className = "flex h-[500px] w-[900px]";
  return container;
}

// Rows are virtualized, so a header far down is not rendered until the view scrolls to it.
async function expectFileHeaderShown(
  screen: Awaited<ReturnType<typeof render>>,
  container: HTMLElement,
  path: string,
) {
  const header = screen.getByText(path, { exact: true }).first();
  await expect.element(header).toBeInTheDocument();
  await vi.waitFor(() => {
    const top = header.element().getBoundingClientRect().top;
    const bounds = container.getBoundingClientRect();
    expect(top).toBeGreaterThanOrEqual(bounds.top);
    expect(top).toBeLessThan(bounds.top + bounds.height / 2);
  });
}

it("scrolls to a file asked for as the tab opens", async () => {
  setup({ paged: true });
  const container = pagedContainer();
  await using screen = await render(tab(0, { path: "early-39.ts", nonce: 1 }), { container });

  await expectFileHeaderShown(screen, container, "early-39.ts");
});

it("pages forward to a file asked for that is not loaded yet, then scrolls to it", async () => {
  setup({ paged: true });
  const container = pagedContainer();
  await using screen = await render(tab(0), { container });
  await expect.element(screen.getByText("early-0.ts", { exact: true }).first()).toBeVisible();

  await screen.rerender(tab(0, { path: "late.ts", nonce: 1 }));

  await expectFileHeaderShown(screen, container, "late.ts");
});

it("never requests the diff of a selected commit the pull request no longer has", async () => {
  setup({ paged: false });
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  // The timeline can open a commit that a force-push removed from the pull request.
  await using screen = await render(
    <PullRequestCodeTab
      scrollerRef={() => {}}
      environmentId={EnvironmentId.make("environment")}
      reference={detail}
      detail={{
        ...detail,
        commits: [
          {
            oid: "kept",
            messageHeadline: "Kept commit",
            committedDate: "2026-09-01T00:00:00Z",
          },
        ],
      }}
      selectedCommitOid="gone"
      onSelectedCommitChange={() => {}}
      onRefresh={() => {}}
    />,
    { container },
  );

  await expect.element(screen.getByText("1 file", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Diff scope: All commits" }))
    .toBeVisible();
  expect(mocks.diffCommits).not.toContain("gone");
});

it("recovers a patchless file on demand and forgets it when refreshed", async () => {
  setup({ paged: false });
  mocks.omitted = true;
  mocks.contents.mockResolvedValue({
    _tag: "Success",
    value: { oldContents: "", newContents: "recovered();\n" },
  });
  const container = pagedContainer();
  container.classList.remove("flex");
  await using screen = await render(tab(0), { container });
  await expect.element(screen.getByRole("button", { name: "Load diff" })).toBeVisible();
  expect(mocks.contents).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Load diff" }).click();

  await expect.element(screen.getByText("+1", { exact: true }).first()).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Load diff" })).not.toBeInTheDocument();
  // Recovery should reveal the file even if diffs start folded.
  await vi.waitFor(() => {
    const hosts = [...screen.container.querySelectorAll("diffs-container")];
    expect(hosts.map((host) => host.shadowRoot?.textContent).join("\n")).toContain("recovered");
  });

  await screen.getByRole("button", { name: /^(Show|Hide) whitespace changes$/ }).click();
  await expect.element(screen.getByText("+1", { exact: true }).first()).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Load diff" })).not.toBeInTheDocument();
  expect(mocks.contents).toHaveBeenCalledTimes(1);

  await screen.rerender(tab(1));
  await expect.element(screen.getByRole("button", { name: "Load diff" })).toBeVisible();
  mocks.contents.mockResolvedValue({
    _tag: "Success",
    value: { oldContents: "", newContents: "refreshed();\n" },
  });
  await screen.getByRole("button", { name: "Load diff" }).click();
  await vi.waitFor(() => {
    const hosts = [...screen.container.querySelectorAll("diffs-container")];
    expect(hosts.map((host) => host.shadowRoot?.textContent).join("\n")).toContain("refreshed");
  });
});

it("shows an unavailable state without a dead-end retry, and verifies empty files after refresh", async () => {
  setup({ paged: false });
  mocks.omitted = true;
  mocks.contents.mockResolvedValueOnce({ _tag: "Failure" });
  mocks.contents.mockResolvedValueOnce({
    _tag: "Success",
    value: { oldContents: "", newContents: "" },
  });
  const container = pagedContainer();
  container.classList.remove("flex");
  await using screen = await render(tab(0), { container });
  await screen.getByRole("button", { name: "Load diff" }).click();
  await expect.element(screen.getByText("Diff unavailable")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Load diff" })).not.toBeInTheDocument();
  await screen.rerender(tab(1));
  await screen.getByRole("button", { name: "Load diff" }).click();
  await expect.element(screen.getByText("No text changes")).toBeVisible();
});
