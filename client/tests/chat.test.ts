import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import type { Conversation, Project } from "../src/types";

const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.matchMedia = () => ({ matches: false }) as MediaQueryList;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

// Load React DOM after the browser globals so its event system uses the DOM.
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App } = await import("../src/App");
const { AuthProvider } = await import("../src/auth/AuthProvider");

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();
const storageKey = "minichat_conversations";
let root: ReturnType<typeof createRoot>;
let requests: Record<string, unknown>[];
let projects: Project[];
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
let chatError: string | undefined;

function savedChats(): Conversation[] {
  return JSON.parse(localStorage.getItem(storageKey) || "[]");
}

function emptyChat(id: string, projectId?: string): Conversation {
  return { id, title: "New Chat", model: "claude-sonnet-4-6", messages: [], createdAt: 1, project_id: projectId ?? null };
}

async function mount(conversations: Conversation[] = []) {
  localStorage.setItem(storageKey, JSON.stringify(conversations));
  await act(async () => {
    root.render(createElement(AuthProvider, { children: createElement(App) }));
  });
}

async function clickButton(text: string) {
  const button = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes(text));
  assert.ok(button, `button containing ${JSON.stringify(text)} exists`);
  await act(async () => button.click());
}

async function finishStream(content = "Synthetic answer") {
  assert.ok(stream, "chat request opened an SSE stream");
  await act(async () => {
    stream!.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
    stream!.enqueue(encoder.encode(`data: ${JSON.stringify({ usage: { inputTokens: 1, outputTokens: 2, cost: 3, balance: 997 } })}\n\n`));
    stream!.enqueue(encoder.encode("data: [DONE]\n\n"));
    stream!.close();
    stream = undefined;
  });
}

beforeEach(() => {
  localStorage.clear();
  requests = [];
  projects = [];
  stream = undefined;
  chatError = undefined;
  root = createRoot(document.getElementById("root")!);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/me") {
      return Response.json({ user: { id: "test-user", username: "tester", role: "user", status: "active", token_balance: 1000, created_at: 1 } });
    }
    if (url === "/api/projects") return Response.json(projects);
    if (url === "/api/chat") {
      requests.push(JSON.parse(init?.body as string));
      if (chatError) return Response.json({ error: chatError }, { status: 502 });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (url === "/api/chats/attachment-chat/attachments") {
      return Response.json({ id: "test-attachment", name: "notes.txt", mimeType: "text/plain", size: 7, chatId: "attachment-chat" });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
});

afterEach(async () => {
  await act(async () => {
    stream?.close();
    root.unmount();
  });
  globalThis.fetch = originalFetch;
});

test("the first send creates a chat and persists its user message and streamed answer", async () => {
  await mount();
  await clickButton("Explain a concept");

  const [chat] = savedChats();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].chatId, chat.id);
  assert.equal(chat.messages[0]?.content, "Explain quantum computing in simple terms");
  assert.equal(chat.messages[1]?.role, "assistant");
  assert.equal(requests[0].projectId, undefined);

  await act(async () => stream!.enqueue(encoder.encode('data: {"content":"Synthetic"}\n\n')));
  assert.equal(savedChats()[0].messages[1].content, "Synthetic");
  await finishStream(" answer");
  assert.equal(savedChats()[0].messages[1].content, "Synthetic answer");
  assert.ok(document.querySelector("main")!.textContent!.includes("Synthetic answer"));
});

test("an API error on the first send stays visible in the newly created chat", async () => {
  chatError = "upstream_error";
  await mount();
  await clickButton("Write code");

  assert.equal(savedChats()[0].messages[0]?.content, "Write a Python function for binary search");
  assert.equal(savedChats()[0].messages[1]?.content, "Error: upstream_error");
  assert.ok(document.querySelector("main")!.textContent!.includes("Error: upstream_error"));
});

test("switching chats during a stream keeps updates in the originating chat", async () => {
  await mount();
  await clickButton("Explain a concept");
  const sourceId = savedChats()[0].id;
  await clickButton("New chat");
  const destinationId = savedChats()[0].id;
  assert.notEqual(sourceId, destinationId);

  await finishStream("Answer for the source chat");
  const chats = savedChats();
  assert.equal(chats.find((chat) => chat.id === sourceId)!.messages[1]?.content, "Answer for the source chat");
  assert.deepEqual(chats.find((chat) => chat.id === destinationId)!.messages, []);
  assert.ok(!document.querySelector("main")!.textContent!.includes("Answer for the source chat"));
});

test("a project chat sends its project ID so server prompt, retrieval and memory can apply", async () => {
  projects = [{ id: "project-a", owner_id: "test-user", name: "Test project", description: null, master_prompt: "Use the project context", memory: null, created_at: 1, updated_at: 1 }];
  await mount([emptyChat("project-chat", "project-a")]);
  await clickButton("Write code");

  assert.equal(requests[0].chatId, "project-chat");
  assert.equal(requests[0].projectId, "project-a");
  await finishStream();
  assert.equal(savedChats()[0].project_id, "project-a");
  assert.equal(savedChats()[0].messages[1].content, "Synthetic answer");
});

test("an attachment-only send retains an empty-text user message for attachment injection", async () => {
  await mount([emptyChat("attachment-chat")]);
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { value: [new File(["fixture"], "notes.txt", { type: "text/plain" })] });
  await act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
  const send = document.querySelector<HTMLButtonElement>("button[title='Send (Enter)']")!;
  assert.equal(send.disabled, false);
  await act(async () => send.click());

  assert.deepEqual(requests[0].messages, [{ role: "user", content: "" }]);
  assert.deepEqual(requests[0].attachmentIds, ["test-attachment"]);
  assert.equal(savedChats()[0].messages[0].attachments?.[0].id, "test-attachment");
  await finishStream();
});
