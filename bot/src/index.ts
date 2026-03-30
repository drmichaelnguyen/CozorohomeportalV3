import "dotenv/config";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";

import { answerCustomerQuestion, questionRequestsHuman } from "./answering.js";
import { config } from "./config.js";
import { sendMessengerTextMessage, verifyFacebookSignature } from "./facebook.js";
import { KnowledgeService } from "./knowledge/service.js";
import {
  getLearningStatus,
  getLearnedEntries,
  getRecentConversationMessages,
  getRecentLearnedEntries,
  isHandoffActive,
  importConversationHistory,
  importLearnedQaEntries,
  clearHandoff,
  markHandoffNoticed,
  recordAdminReplyAndLearn,
  recordBotReply,
  recordCustomerMessage,
  setLearnedEntryStatus,
  setHandoffActive
} from "./learning.js";
import {
  addRouterTrainingExample,
  deleteRouterTrainingExample,
  getRecentRouterExamples,
  updateRouterTrainingExample
} from "./prompt-training.js";

type RawBodyRequest = express.Request & {
  rawBody?: Buffer;
};

type MessengerWebhookEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
  };
};

type MessengerWebhookBody = {
  object?: string;
  entry?: Array<{
    messaging?: MessengerWebhookEvent[];
  }>;
};

const app = express();
const knowledgeService = new KnowledgeService();
const adminSessions = new Map<string, { username: string; expiresAt: number }>();

type ChatHistoryRow = {
  conversationKey: string;
  role: "customer" | "admin" | "bot";
  text: string;
  channel: string;
  createdAt: string;
  source: string;
};

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncateText(text: string, max = 160) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(1, max - 1))}…`;
}

function parseCookies(cookieHeader: string | undefined) {
  const cookies = new Map<string, string>();
  for (const chunk of String(cookieHeader ?? "").split(";")) {
    const [rawKey, ...rest] = chunk.trim().split("=");
    if (!rawKey) {
      continue;
    }
    cookies.set(rawKey, decodeURIComponent(rest.join("=")));
  }
  return cookies;
}

function safeEqualText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function getAdminSession(req: express.Request) {
  const token = parseCookies(req.header("cookie")).get("cozoro_admin_session");
  if (!token) {
    return null;
  }

  const session = adminSessions.get(token);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    adminSessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = getAdminSession(req);
  if (!session) {
    res.redirect("/cozoro/login");
    return;
  }
  next();
}

async function readChatHistoryRows(limit = 1200) {
  try {
    const raw = await readFile(config.chatHistoryFile, "utf8");
    const rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Partial<ChatHistoryRow>;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .map((item) => ({
        conversationKey: String(item?.conversationKey ?? ""),
        role:
          item?.role === "customer" || item?.role === "admin" || item?.role === "bot"
            ? item.role
            : "customer",
        text: String(item?.text ?? ""),
        channel: String(item?.channel ?? "unknown"),
        createdAt: String(item?.createdAt ?? ""),
        source: String(item?.source ?? "unknown")
      }))
      .filter((item) => item.conversationKey && item.text.trim());

    return rows.slice(-Math.max(1, limit));
  } catch {
    return [] as ChatHistoryRow[];
  }
}

function summarizeConversationVi(messages: ChatHistoryRow[]) {
  const customerTexts = messages
    .filter((item) => item.role === "customer")
    .map((item) => item.text.toLowerCase());
  const allText = customerTexts.join("\n");
  const topics: string[] = [];

  if (/(giá|gia|bao nhiêu|bao nhieu|chi phí|chi phi|tiền)/i.test(allText)) topics.push("giá/phí");
  if (/(khuyến mãi|khuyen mai|ưu đãi|uu dai|giảm giá|giam gia)/i.test(allText)) topics.push("khuyến mãi");
  if (/(3 tháng|tháng|thang|ngắn hạn|ngan han|hợp đồng|hop dong)/i.test(allText)) topics.push("hợp đồng/thời hạn");
  if (/(giặt|giat|sấy|say|laundry|dryer|washer)/i.test(allText)) topics.push("giặt sấy");
  if (/(coin|coins|cozoro coins|điểm|diem)/i.test(allText)) topics.push("coins");
  if (/(referral|giới thiệu|gioi thieu)/i.test(allText)) topics.push("giới thiệu");
  if (/(xem phòng|xem phong|tham quan|đặt lịch|dat lich|đến xem|den xem)/i.test(allText)) topics.push("xem phòng");
  if (/(hủy|huy|bảo lưu|bao luu|chấm dứt|cham dut)/i.test(allText)) topics.push("hủy/bảo lưu");

  const lastCustomer = messages
    .slice()
    .reverse()
    .find((item) => item.role === "customer");
  const hasAdmin = messages.some((item) => item.role === "admin");
  const hasHandoffRequest = customerTexts.some((text) =>
    /(gặp người thật|gặp nhân viên|chat với nhân viên|human|staff)/i.test(text)
  );

  const topicText = topics.length ? topics.join(", ") : "nhu cầu ở trọ chung";
  const statusText = hasAdmin
    ? "đã có nhân viên tham gia hỗ trợ"
    : hasHandoffRequest
      ? "khách có yêu cầu gặp người thật"
      : "bot đang tự động tư vấn";

  return `Khách quan tâm: ${topicText}. Câu gần nhất: "${truncateText(lastCustomer?.text ?? "chưa có", 120)}". Trạng thái: ${statusText}.`;
}

function formatConversationContext(messages: Array<{ role: string; text: string }>) {
  const kept = messages
    .map((message) => ({
      role: message.role === "customer" ? "Customer" : message.role === "admin" ? "Admin" : "Cozoro",
      text: String(message.text ?? "").trim()
    }))
    .filter((message) => message.text);

  if (!kept.length) {
    return "";
  }

  return kept.map((message) => `${message.role}: ${message.text}`).join("\n");
}

const playgroundHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cozorohome Bot Playground</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: #fffaf1;
        --ink: #17301f;
        --muted: #5f6f62;
        --line: #d7ccb8;
        --accent: #1f6a42;
        --accent-2: #e0f0e5;
        --user: #eff7f2;
        --bot: #fff4de;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(234, 214, 174, 0.55), transparent 32%),
          linear-gradient(180deg, #f8f1e3 0%, #f3ebdf 100%);
        color: var(--ink);
      }

      .shell {
        max-width: 920px;
        margin: 0 auto;
        padding: 24px 16px 40px;
      }

      .hero {
        background: linear-gradient(135deg, rgba(255,250,241,0.95), rgba(249,241,226,0.92));
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 24px;
        box-shadow: 0 18px 40px rgba(63, 46, 23, 0.08);
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(28px, 4vw, 44px);
        line-height: 1;
      }

      .hero p {
        margin: 0;
        color: var(--muted);
        max-width: 60ch;
        line-height: 1.5;
      }

      .hero-actions {
        margin-top: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .hero-actions a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 10px 14px;
        text-decoration: none;
        font-weight: 700;
        border: 1px solid #c8baa1;
        color: var(--ink);
        background: #fff;
      }

      .hero-actions a.primary {
        border-color: var(--accent);
        background: var(--accent);
        color: #fff;
      }

      .layout {
        display: grid;
        grid-template-columns: 1.7fr 1fr;
        gap: 16px;
        margin-top: 16px;
      }

      .panel {
        background: rgba(255, 250, 241, 0.98);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: 0 18px 40px rgba(63, 46, 23, 0.05);
      }

      .chat {
        display: grid;
        grid-template-rows: 1fr auto;
        min-height: 68vh;
      }

      .messages {
        padding: 18px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .bubble {
        padding: 12px 14px;
        border-radius: 18px;
        line-height: 1.45;
        white-space: pre-wrap;
        border: 1px solid transparent;
      }

      .bubble.user {
        background: var(--user);
        border-color: #c9dfd0;
        align-self: flex-end;
        max-width: 82%;
      }

      .bubble.bot {
        background: var(--bot);
        border-color: #ecd7ad;
        align-self: flex-start;
        max-width: 88%;
      }

      .composer {
        padding: 16px;
        border-top: 1px solid var(--line);
        display: grid;
        gap: 10px;
      }

      textarea, input {
        width: 100%;
        border: 1px solid #c8baa1;
        border-radius: 14px;
        padding: 12px 14px;
        font: inherit;
        background: white;
        color: var(--ink);
      }

      textarea {
        min-height: 110px;
        resize: vertical;
      }

      .row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 700;
        background: var(--accent);
        color: white;
        cursor: pointer;
      }

      button:disabled {
        opacity: 0.65;
        cursor: wait;
      }

      .card {
        padding: 18px;
      }

      .card h2 {
        margin: 0 0 10px;
        font-size: 18px;
      }

      .card p, .card li {
        color: var(--muted);
        line-height: 1.5;
      }

      ul {
        margin: 10px 0 0;
        padding-left: 18px;
      }

      .status {
        margin-top: 10px;
        font-size: 14px;
        color: var(--muted);
      }

      @media (max-width: 860px) {
        .layout {
          grid-template-columns: 1fr;
        }

        .chat {
          min-height: 58vh;
        }

        .row {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <h1>Cozorohome Bot Playground</h1>
        <p>
          Đây là trang thử bot dành cho khách tiềm năng. Mặc định bot sẽ trả lời bằng tiếng Việt,
          và chỉ chuyển sang tiếng Anh khi khách dùng tiếng Anh hoặc yêu cầu rõ ràng.
        </p>
        <div class="hero-actions">
          <a class="primary" href="/cozoro/login">Đăng nhập Cozoro</a>
        </div>
      </section>

      <section class="layout">
        <section class="panel chat">
          <div id="messages" class="messages">
            <div class="bubble bot">Bạn có thể hỏi thử tại đây. Ví dụ: "Ưu đãi giới thiệu hiện tại là bao nhiêu?"</div>
          </div>

          <form id="chat-form" class="composer">
            <textarea id="question" placeholder="Nhập câu hỏi về ở tại Cozoro..." required></textarea>
            <div class="row">
              <input id="referral-name" placeholder="Tên người giới thiệu (không bắt buộc)" />
              <input id="referral-phone" placeholder="Số điện thoại người giới thiệu (không bắt buộc)" />
            </div>
            <label style="display:flex; gap:8px; align-items:flex-start; color: var(--muted); font-size: 14px;">
              <input id="teach-mode" type="checkbox" style="margin-top:3px; width:auto;" />
              Tin nhắn này là câu trả lời chỉnh sửa của tester để dạy bot (học từ câu hỏi gần nhất trong cuộc chat).
            </label>
            <div>
              <button id="send-button" type="submit">Gửi câu hỏi</button>
            </div>
            <div id="status" class="status">Sẵn sàng.</div>
          </form>
        </section>

        <aside class="panel card">
          <h2>Nên Test Gì</h2>
          <ul>
            <li>Ưu đãi giới thiệu</li>
            <li>Chính sách hợp đồng và hủy ở</li>
            <li>Quy định giặt sấy và vệ sinh</li>
            <li>Chặn câu hỏi lạc chủ đề</li>
            <li>Bảo vệ thông tin cư dân hiện tại</li>
          </ul>
          <p class="status">Route hiện tại: <code>/prospect/ask</code></p>
        </aside>
      </section>
    </main>

    <script>
      const form = document.getElementById("chat-form");
      const messages = document.getElementById("messages");
      const status = document.getElementById("status");
      const sendButton = document.getElementById("send-button");
      const questionInput = document.getElementById("question");
      const referralNameInput = document.getElementById("referral-name");
      const referralPhoneInput = document.getElementById("referral-phone");
      const teachModeInput = document.getElementById("teach-mode");
      const storageKey = "cozoro_playground_conversation_key";
      const conversationKey =
        window.localStorage.getItem(storageKey) ||
        (Math.random().toString(16).slice(2) + Date.now().toString(16));
      window.localStorage.setItem(storageKey, conversationKey);

      function addBubble(kind, text) {
        const div = document.createElement("div");
        div.className = "bubble " + kind;
        div.textContent = text;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const question = questionInput.value.trim();
        const referralName = referralNameInput.value.trim();
        const referralPhone = referralPhoneInput.value.trim();
        const teachMode = Boolean(teachModeInput.checked);

        if (!question) {
          return;
        }

        addBubble("user", teachMode ? "[TEACH] " + question : question);
        questionInput.value = "";
        status.textContent = "Đang chờ bot trả lời...";
        sendButton.disabled = true;

        const payload = { question, conversationKey };
        if (teachMode) {
          payload.asAdminCorrection = true;
        }
        if (referralName && referralPhone) {
          payload.referral = { name: referralName, phone: referralPhone };
        }

        try {
          const response = await fetch("/prospect/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            throw new Error("Request failed with " + response.status);
          }

          const data = await response.json();
          addBubble("bot", data.answer || "Bot chưa trả về nội dung.");
          if (teachMode) {
            teachModeInput.checked = false;
          }
          status.textContent = "Xong.";
        } catch (error) {
          addBubble("bot", "Playground hiện chưa kết nối được tới bot.");
          status.textContent = error instanceof Error ? error.message : "Gửi yêu cầu thất bại.";
        } finally {
          sendButton.disabled = false;
        }
      });

      questionInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        if (event.shiftKey || event.isComposing) {
          return;
        }

        event.preventDefault();
        form.requestSubmit();
      });
    </script>
  </body>
</html>`;

const privacyPolicyHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cozoro Home Privacy Policy</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f2ea;
        --panel: #fffdf9;
        --ink: #1f2e22;
        --muted: #5b6a61;
        --line: #d9cfbf;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background: linear-gradient(180deg, #f9f4eb 0%, #f2ede4 100%);
        color: var(--ink);
      }
      main {
        max-width: 900px;
        margin: 0 auto;
        padding: 28px 16px 42px;
      }
      article {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 24px;
      }
      h1 { margin-top: 0; }
      h2 { margin-top: 24px; }
      p, li { line-height: 1.55; color: var(--muted); }
      a { color: #0f6b48; }
      code {
        background: #f2ecdf;
        padding: 2px 6px;
        border-radius: 6px;
      }
      .meta {
        font-size: 14px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>Cozoro Home Privacy Policy</h1>
        <p class="meta">Effective date: March 29, 2026</p>
        <p>
          This Privacy Policy describes how Cozoro Home collects, uses, stores, and protects
          information when you interact with Cozoro Home through Facebook Messenger and chatbot
          channels.
        </p>

        <h2>1. Information We Collect</h2>
        <ul>
          <li>Messenger profile identifiers provided by Meta (for example Page-scoped ID).</li>
          <li>Messages and inquiry content you send to Cozoro Home.</li>
          <li>Conversation metadata used to provide support and improve answer quality.</li>
        </ul>

        <h2>2. How We Use Information</h2>
        <ul>
          <li>Answer questions about Cozoro Home stays, policies, pricing, and promotions.</li>
          <li>Route requests to human support when needed.</li>
          <li>Improve response quality and maintain service safety.</li>
        </ul>

        <h2>3. Data Sharing</h2>
        <p>
          Cozoro Home does not sell personal information. Data may be processed by trusted service
          providers strictly to operate customer support systems.
        </p>

        <h2>4. Data Retention</h2>
        <p>
          We retain chat and support records only as long as necessary for support, compliance, and
          internal service operations.
        </p>

        <h2>5. Your Rights</h2>
        <p>
          You may request access, correction, or deletion of your data at any time by contacting
          Cozoro Home:
        </p>
        <ul>
          <li>Email: <a href="mailto:cozorohome@gmail.com">cozorohome@gmail.com</a></li>
          <li>Phone: <a href="tel:+84902949682">0902 949 682</a></li>
        </ul>
        <p>
          Data deletion instructions are available at
          <a href="/data-deletion"><code>/data-deletion</code></a>.
        </p>

        <h2>6. Policy Updates</h2>
        <p>
          We may update this policy from time to time. The latest version is always available at
          <a href="/privacy-policy"><code>/privacy-policy</code></a>.
        </p>
      </article>
    </main>
  </body>
</html>`;

const dataDeletionHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cozoro Home Data Deletion Instructions</title>
    <style>
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background: #f7f3eb;
        color: #1f2e22;
      }
      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 28px 16px 40px;
      }
      article {
        background: #fffdf9;
        border: 1px solid #d9cfbf;
        border-radius: 18px;
        padding: 24px;
      }
      p, li { line-height: 1.55; color: #5b6a61; }
      h1 { margin-top: 0; }
      a { color: #0f6b48; }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>Data Deletion Instructions</h1>
        <p>
          If you want Cozoro Home to delete your Messenger-related data, please send a request with:
        </p>
        <ul>
          <li>Your Facebook profile name</li>
          <li>Your phone number used for inquiry (if any)</li>
          <li>A short note: "Request data deletion"</li>
        </ul>
        <p>
          Contact channel:
          <a href="mailto:cozorohome@gmail.com">cozorohome@gmail.com</a>
          or <a href="tel:+84902949682">0902 949 682</a>
        </p>
        <p>
          Cozoro Home will verify the request and process deletion within a reasonable period under
          applicable rules.
        </p>
      </article>
    </main>
  </body>
</html>`;

const jsonParser = express.json({
  verify(req, _res, buffer) {
    (req as RawBodyRequest).rawBody = Buffer.from(buffer);
  }
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cozorohome-bot",
    loadedAt: knowledgeService.getStatus().loadedAt
  });
});

app.get("/knowledge/status", (_req, res) => {
  res.json(knowledgeService.getStatus());
});

app.get("/learning/status", async (_req, res) => {
  res.json(await getLearningStatus());
});

app.get("/learning/examples", async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 40)));
  res.json({
    entries: await getRecentLearnedEntries(limit)
  });
});

app.post("/learning/import-qa", express.json({ limit: "2mb" }), async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const imported = await importLearnedQaEntries(
    entries.map((entry: any) => ({
      question: String(entry?.question ?? ""),
      answer: String(entry?.answer ?? ""),
      source: String(entry?.source ?? "manual-import"),
      channel: String(entry?.channel ?? "manual"),
      createdAt: entry?.createdAt ? String(entry.createdAt) : undefined,
      adminAuthor: entry?.adminAuthor ? String(entry.adminAuthor) : undefined,
      tags: Array.isArray(entry?.tags) ? entry.tags.map((tag: unknown) => String(tag)) : undefined
    }))
  );

  if (imported.length) {
    await knowledgeService.refresh();
  }

  res.json({
    importedCount: imported.length,
    entries: imported
  });
});

app.post("/learning/import-conversations", express.json({ limit: "4mb" }), async (req, res) => {
  const conversations = Array.isArray(req.body?.conversations) ? req.body.conversations : [];
  const imported = await importConversationHistory(
    conversations.map((conversation: any) => ({
      channel: conversation?.channel ? String(conversation.channel) : undefined,
      source: conversation?.source ? String(conversation.source) : undefined,
      adminAuthor: conversation?.adminAuthor ? String(conversation.adminAuthor) : undefined,
      conversationKey: conversation?.conversationKey ? String(conversation.conversationKey) : undefined,
      messages: Array.isArray(conversation?.messages)
        ? conversation.messages
            .map((message: unknown) => {
              const item = message as {
                role?: unknown;
                text?: unknown;
                createdAt?: unknown;
              };

              return {
                role:
                  item.role === "customer" || item.role === "admin"
                    ? item.role
                    : "customer",
                text: String(item.text ?? ""),
                createdAt: item.createdAt ? String(item.createdAt) : undefined
              };
            })
            .filter((message: { text: string }) => message.text.trim())
        : []
    }))
  );

  if (imported.length) {
    await knowledgeService.refresh();
  }

  res.json({
    importedCount: imported.length,
    entries: imported
  });
});

app.get("/playground", (_req, res) => {
  res.type("html").send(playgroundHtml);
});

app.get("/privacy-policy", (_req, res) => {
  res.type("html").send(privacyPolicyHtml);
});

app.get("/data-deletion", (_req, res) => {
  res.type("html").send(dataDeletionHtml);
});

app.get("/cozoro", (req, res) => {
  if (getAdminSession(req)) {
    res.redirect("/cozoro/dashboard");
    return;
  }
  res.redirect("/cozoro/login");
});

app.get("/cozoro/login", (req, res) => {
  const hasSession = Boolean(getAdminSession(req));
  if (hasSession) {
    res.redirect("/cozoro/dashboard");
    return;
  }

  const error = String(req.query.error ?? "").trim();
  const errorMessage =
    error === "invalid" ? "Sai tài khoản hoặc mật khẩu." : error === "expired" ? "Phiên đăng nhập đã hết hạn." : "";

  const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cozoro Admin Login</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #f8f1e6 0%, #eee4d3 100%);
        font-family: Georgia, "Times New Roman", serif;
        color: #1e2f22;
      }
      .card {
        width: min(420px, 92vw);
        background: #fffaf2;
        border: 1px solid #d8cab2;
        border-radius: 18px;
        padding: 22px;
        box-shadow: 0 16px 38px rgba(63, 46, 23, 0.12);
      }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 0 0 14px; color: #5f6f62; }
      label { display: block; margin-top: 12px; font-weight: 700; }
      input {
        width: 100%;
        box-sizing: border-box;
        margin-top: 6px;
        border: 1px solid #cdbb9e;
        border-radius: 10px;
        padding: 10px 12px;
        font: inherit;
      }
      button {
        margin-top: 16px;
        border: 0;
        border-radius: 999px;
        padding: 10px 16px;
        background: #1f6a42;
        color: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .err {
        margin-top: 8px;
        color: #8c1d1d;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Cozoro Bot Admin</h1>
      <p>Đăng nhập để xem lịch sử chat và tóm tắt hội thoại bằng tiếng Việt.</p>
      <form method="post" action="/cozoro/login">
        <label for="username">Tài khoản</label>
        <input id="username" name="username" autocomplete="username" required />
        <label for="password">Mật khẩu</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Đăng nhập</button>
      </form>
      ${errorMessage ? `<div class="err">${escapeHtml(errorMessage)}</div>` : ""}
    </main>
  </body>
</html>`;

  res.type("html").send(html);
});

app.post("/cozoro/login", express.urlencoded({ extended: false }), (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");

  if (!safeEqualText(username, config.adminUsername) || !safeEqualText(password, config.adminPassword)) {
    res.redirect("/cozoro/login?error=invalid");
    return;
  }

  const token = randomBytes(24).toString("hex");
  const maxAgeSeconds = config.adminSessionTtlHours * 60 * 60;
  adminSessions.set(token, {
    username,
    expiresAt: Date.now() + maxAgeSeconds * 1000
  });

  res.setHeader(
    "Set-Cookie",
    `cozoro_admin_session=${encodeURIComponent(token)}; Path=/cozoro; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
  res.redirect("/cozoro/dashboard");
});

app.post("/cozoro/logout", (req, res) => {
  const token = parseCookies(req.header("cookie")).get("cozoro_admin_session");
  if (token) {
    adminSessions.delete(token);
  }
  res.setHeader(
    "Set-Cookie",
    "cozoro_admin_session=; Path=/cozoro; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  res.redirect("/cozoro/login");
});

app.post("/cozoro/learned/:id/status", requireAdminAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const status = String(req.body?.status ?? "").trim();
  const conversation = String(req.body?.conversation ?? "").trim();
  const session = getAdminSession(req);

  if (!id || (status !== "approved" && status !== "rejected" && status !== "pending")) {
    res.redirect(`/cozoro/dashboard${conversation ? `?conversation=${encodeURIComponent(conversation)}` : ""}`);
    return;
  }

  const result = await setLearnedEntryStatus(id, status, session?.username);
  if (result.updated) {
    await knowledgeService.refresh();
  }

  res.redirect(`/cozoro/dashboard${conversation ? `?conversation=${encodeURIComponent(conversation)}` : ""}`);
});

app.get("/cozoro/trainer", requireAdminAuth, async (req, res) => {
  const session = getAdminSession(req);
  const added = String(req.query.added ?? "").trim();
  const routerAdded = String(req.query.router_added ?? "").trim();
  const routerUpdated = String(req.query.router_updated ?? "").trim();
  const routerDeleted = String(req.query.router_deleted ?? "").trim();
  const error = String(req.query.error ?? "").trim();
  const routerError = String(req.query.router_error ?? "").trim();
  const recentRouterExamples = await getRecentRouterExamples(40);

  const flash =
    added === "1"
      ? "<p style='color:#1f6a42; margin: 10px 0 0;'>Đã lưu tri thức mới thành công.</p>"
      : error === "duplicate"
        ? "<p style='color:#8c1d1d; margin: 10px 0 0;'>Mục này đã tồn tại, bot không lưu trùng.</p>"
        : error === "invalid"
          ? "<p style='color:#8c1d1d; margin: 10px 0 0;'>Vui lòng nhập đủ câu hỏi và câu trả lời.</p>"
          : "";
  const routerFlash =
    routerAdded === "1"
      ? "<p style='color:#1f6a42; margin: 10px 0 0;'>Đã lưu ví dụ phân loại cho model nhỏ.</p>"
      : routerUpdated === "1"
        ? "<p style='color:#1f6a42; margin: 10px 0 0;'>Đã cập nhật ví dụ phân loại.</p>"
        : routerDeleted === "1"
          ? "<p style='color:#1f6a42; margin: 10px 0 0;'>Đã xóa ví dụ phân loại.</p>"
      : routerError === "duplicate"
        ? "<p style='color:#8c1d1d; margin: 10px 0 0;'>Ví dụ phân loại này đã tồn tại.</p>"
        : routerError === "invalid"
          ? "<p style='color:#8c1d1d; margin: 10px 0 0;'>Vui lòng nhập message và chọn decision/route hợp lệ.</p>"
          : routerError === "not_found"
            ? "<p style='color:#8c1d1d; margin: 10px 0 0;'>Không tìm thấy ví dụ router để sửa hoặc xóa.</p>"
          : "";

  const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cozoro Bot Trainer</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Georgia, "Times New Roman", serif;
        background: linear-gradient(180deg, #f8f1e6 0%, #eee4d3 100%);
        color: #1e2f22;
      }
      .shell {
        max-width: 980px;
        margin: 0 auto;
        padding: 14px 12px 92px;
      }
      .bar {
        background: #fffaf2;
        border: 1px solid #d8cab2;
        border-radius: 14px;
        padding: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .desktop-nav {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .desktop-nav a {
        text-decoration: none;
        border: 1px solid #d1c2a8;
        border-radius: 999px;
        padding: 7px 12px;
        color: #1e2f22;
        background: #fff;
        font-weight: 700;
      }
      .card {
        margin-top: 12px;
        background: #fffaf2;
        border: 1px solid #d8cab2;
        border-radius: 14px;
        padding: 14px;
      }
      h1 { margin: 0; font-size: 28px; }
      h2 { margin: 0; font-size: 22px; }
      p { color: #5f6f62; }
      label {
        display: block;
        margin-top: 10px;
        font-weight: 700;
      }
      input, textarea, select {
        width: 100%;
        box-sizing: border-box;
        margin-top: 6px;
        border: 1px solid #ccb99a;
        border-radius: 10px;
        padding: 10px 12px;
        font: inherit;
        background: #fff;
      }
      textarea {
        min-height: 120px;
        resize: vertical;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      button {
        margin-top: 14px;
        border: 0;
        border-radius: 999px;
        padding: 10px 16px;
        background: #1f6a42;
        color: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .hint {
        margin-top: 12px;
        color: #5f6f62;
        font-size: 14px;
      }
      .list {
        margin-top: 12px;
        display: grid;
        gap: 8px;
      }
      .item {
        background: #fff;
        border: 1px solid #d8cab2;
        border-radius: 12px;
        padding: 10px 12px;
      }
      .item details {
        margin-top: 10px;
      }
      .item summary {
        cursor: pointer;
        color: #1f6a42;
        font-weight: 700;
      }
      .item strong {
        display: block;
        margin-bottom: 4px;
      }
      .meta {
        color: #5f6f62;
        font-size: 13px;
        margin-top: 4px;
      }
      .tags {
        margin-top: 4px;
        font-size: 13px;
        color: #5f6f62;
      }
      .inline-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .inline-actions button.danger {
        background: #8c1d1d;
      }
      .logout button {
        margin-top: 0;
      }
      .mobile-dock {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
        background: rgba(255, 250, 242, 0.96);
        border-top: 1px solid #d8cab2;
        display: none;
        z-index: 50;
      }
      .mobile-dock-inner {
        max-width: 980px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .mobile-dock a,
      .mobile-dock button {
        margin: 0;
        height: 42px;
        text-align: center;
        text-decoration: none;
        border: 1px solid #ccb99a;
        border-radius: 999px;
        background: #fff;
        color: #1e2f22;
        font: inherit;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      @media (max-width: 760px) {
        .grid {
          grid-template-columns: 1fr;
        }
        .desktop-nav {
          display: none;
        }
        .mobile-dock {
          display: block;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="bar">
        <div>
          <strong>Cozoro Bot Trainer</strong>
          <div style="color:#5f6f62; font-size: 14px;">Admin: ${escapeHtml(session?.username ?? "cozoro")}</div>
        </div>
        <div class="desktop-nav">
          <a href="/cozoro/dashboard">Dashboard</a>
          <a href="/playground">Playground</a>
          <form class="logout" method="post" action="/cozoro/logout">
            <button type="submit">Đăng xuất</button>
          </form>
        </div>
      </section>

      <section class="card">
        <h1>Train Bot Thủ Công</h1>
        <p>Nhập mẫu huấn luyện dạng “khách hỏi thế này, Cozoro trả lời thế kia”.</p>
        ${flash}
        <form method="post" action="/cozoro/trainer">
          <label for="question">Question (câu khách hỏi)</label>
          <textarea id="question" name="question" placeholder="Ví dụ: em ở 3 tháng thì giá sao ạ?" required></textarea>

          <label for="answer">Answer (câu bot cần trả lời)</label>
          <textarea id="answer" name="answer" placeholder="Ví dụ: Dạ gói 3 tháng giảm 500.000đ, nhưng có phụ phí ngắn hạn +8%..." required></textarea>

          <div class="grid">
            <div>
              <label for="status">Trạng thái tri thức</label>
              <select id="status" name="status">
                <option value="approved">approved (dùng ngay cho RAG)</option>
                <option value="pending">pending (chờ duyệt)</option>
              </select>
            </div>
            <div>
              <label for="tags">Tags (phân tách bằng dấu phẩy)</label>
              <input id="tags" name="tags" placeholder="pricing, discount, short-term" />
            </div>
          </div>

          <button type="submit">Lưu Tri Thức</button>
        </form>
        <p class="hint">
          Gợi ý: trả lời ngắn gọn, đúng chính sách, không chứa thông tin riêng tư khách đang ở.
        </p>
      </section>
      <section class="card">
        <h2>Train Router Model Nhỏ</h2>
        <p>Dạy model phân loại hiểu chat ngắn, teencode, slang và context follow-up.</p>
        ${routerFlash}
        <form method="post" action="/cozoro/trainer/router">
          <label for="router-input">Message khách</label>
          <textarea id="router-input" name="input" placeholder="Ví dụ: q10 con cho k" required></textarea>

          <label for="router-context">Context trước đó (không bắt buộc)</label>
          <textarea id="router-context" name="context" placeholder="Ví dụ: trước đó khách đang hỏi khuyến mãi 3 tháng"></textarea>

          <div class="grid">
            <div>
              <label for="router-decision">Decision</label>
              <select id="router-decision" name="decision">
                <option value="allow">allow</option>
                <option value="deny">deny</option>
              </select>
            </div>
            <div>
              <label for="router-route">Route</label>
              <select id="router-route" name="route">
                <option value="simple_policy">simple_policy</option>
                <option value="deep_policy">deep_policy</option>
                <option value="off_topic">off_topic</option>
              </select>
            </div>
          </div>

          <label for="router-reason">Ghi chú / lý do</label>
          <input id="router-reason" name="reason" placeholder="Ví dụ: hỏi giường trống bằng slang nên vẫn là allow" />

          <label for="router-tags">Tags</label>
          <input id="router-tags" name="tags" placeholder="availability, slang, q10" />

          <button type="submit">Lưu Ví Dụ Router</button>
        </form>
        <div class="list">
          ${
            recentRouterExamples.length
              ? recentRouterExamples
                  .map(
                    (example) => `<article class="item">
              <strong>${escapeHtml(example.input)}</strong>
              ${
                example.context?.trim()
                  ? `<div>Context: ${escapeHtml(truncateText(example.context, 120))}</div>`
                  : ""
              }
              ${
                example.reason?.trim()
                  ? `<div class="meta">Lý do: ${escapeHtml(truncateText(example.reason, 140))}</div>`
                  : ""
              }
              <div class="meta">decision=${escapeHtml(example.decision)} • route=${escapeHtml(example.route)} • source=${escapeHtml(example.source ?? "local")}</div>
              ${
                example.tags?.length
                  ? `<div class="tags">tags: ${escapeHtml(example.tags.join(", "))}</div>`
                  : ""
              }
              <details>
                <summary>Sửa ví dụ này</summary>
                <form method="post" action="/cozoro/trainer/router/${encodeURIComponent(example.id)}/update">
                  <label>Message khách</label>
                  <textarea name="input" required>${escapeHtml(example.input)}</textarea>
                  <label>Context trước đó</label>
                  <textarea name="context">${escapeHtml(example.context ?? "")}</textarea>
                  <div class="grid">
                    <div>
                      <label>Decision</label>
                      <select name="decision">
                        <option value="allow" ${example.decision === "allow" ? "selected" : ""}>allow</option>
                        <option value="deny" ${example.decision === "deny" ? "selected" : ""}>deny</option>
                      </select>
                    </div>
                    <div>
                      <label>Route</label>
                      <select name="route">
                        <option value="simple_policy" ${example.route === "simple_policy" ? "selected" : ""}>simple_policy</option>
                        <option value="deep_policy" ${example.route === "deep_policy" ? "selected" : ""}>deep_policy</option>
                        <option value="off_topic" ${example.route === "off_topic" ? "selected" : ""}>off_topic</option>
                      </select>
                    </div>
                  </div>
                  <label>Ghi chú / lý do</label>
                  <input name="reason" value="${escapeHtml(example.reason ?? "")}" />
                  <label>Tags</label>
                  <input name="tags" value="${escapeHtml((example.tags ?? []).join(", "))}" />
                  <div class="inline-actions">
                    <button type="submit">Lưu chỉnh sửa</button>
                  </div>
                </form>
              </details>
              <form method="post" action="/cozoro/trainer/router/${encodeURIComponent(example.id)}/delete">
                <div class="inline-actions">
                  <button class="danger" type="submit">Xóa ví dụ</button>
                </div>
              </form>
            </article>`
                  )
                  .join("")
              : "<p class='hint'>Chưa có ví dụ router nào.</p>"
          }
        </div>
      </section>
    </main>
    <nav class="mobile-dock" aria-label="Điều hướng nhanh">
      <div class="mobile-dock-inner">
        <a href="/cozoro/dashboard">Dashboard</a>
        <a href="/playground">Playground</a>
        <form method="post" action="/cozoro/logout">
          <button type="submit">Đăng xuất</button>
        </form>
      </div>
    </nav>
  </body>
</html>`;

  res.type("html").send(html);
});

app.post("/cozoro/trainer", requireAdminAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  const answer = String(req.body?.answer ?? "").trim();
  const statusRaw = String(req.body?.status ?? "approved").trim().toLowerCase();
  const tagsRaw = String(req.body?.tags ?? "").trim();
  const session = getAdminSession(req);

  if (!question || !answer) {
    res.redirect("/cozoro/trainer?error=invalid");
    return;
  }

  const status = statusRaw === "pending" ? "pending" : "approved";
  const tags = tagsRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);

  const imported = await importLearnedQaEntries([
    {
      question,
      answer,
      source: "admin-trainer-manual",
      channel: "admin-trainer",
      adminAuthor: session?.username ?? "cozoro-admin",
      status,
      tags: ["manual-trainer", ...tags]
    }
  ]);

  if (!imported.length) {
    res.redirect("/cozoro/trainer?error=duplicate");
    return;
  }

  await knowledgeService.refresh();
  res.redirect("/cozoro/trainer?added=1");
});

app.post("/cozoro/trainer/router", requireAdminAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const input = String(req.body?.input ?? "").trim();
  const context = String(req.body?.context ?? "").trim();
  const decisionRaw = String(req.body?.decision ?? "").trim();
  const routeRaw = String(req.body?.route ?? "").trim();
  const reason = String(req.body?.reason ?? "").trim();
  const tagsRaw = String(req.body?.tags ?? "").trim();
  const session = getAdminSession(req);

  if (
    !input ||
    (decisionRaw !== "allow" && decisionRaw !== "deny") ||
    (routeRaw !== "simple_policy" && routeRaw !== "deep_policy" && routeRaw !== "off_topic")
  ) {
    res.redirect("/cozoro/trainer?router_error=invalid");
    return;
  }

  const tags = tagsRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);

  const result = await addRouterTrainingExample({
    input,
    context: context || undefined,
    decision: decisionRaw,
    route: routeRaw,
    reason: reason || undefined,
    tags,
    source: `admin-router-trainer:${session?.username ?? "cozoro-admin"}`
  });

  if (!result.created) {
    res.redirect("/cozoro/trainer?router_error=duplicate");
    return;
  }

  res.redirect("/cozoro/trainer?router_added=1");
});

app.post(
  "/cozoro/trainer/router/:id/update",
  requireAdminAuth,
  express.urlencoded({ extended: false }),
  async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const input = String(req.body?.input ?? "").trim();
    const context = String(req.body?.context ?? "").trim();
    const decisionRaw = String(req.body?.decision ?? "").trim();
    const routeRaw = String(req.body?.route ?? "").trim();
    const reason = String(req.body?.reason ?? "").trim();
    const tagsRaw = String(req.body?.tags ?? "").trim();
    const session = getAdminSession(req);

    if (
      !id ||
      !input ||
      (decisionRaw !== "allow" && decisionRaw !== "deny") ||
      (routeRaw !== "simple_policy" && routeRaw !== "deep_policy" && routeRaw !== "off_topic")
    ) {
      res.redirect("/cozoro/trainer?router_error=invalid");
      return;
    }

    const tags = tagsRaw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);

    const result = await updateRouterTrainingExample(id, {
      input,
      context: context || undefined,
      decision: decisionRaw,
      route: routeRaw,
      reason: reason || undefined,
      tags,
      source: `admin-router-trainer:${session?.username ?? "cozoro-admin"}`
    });

    if (!result.updated) {
      res.redirect(`/cozoro/trainer?router_error=${encodeURIComponent(result.reason)}`);
      return;
    }

    res.redirect("/cozoro/trainer?router_updated=1");
  }
);

app.post(
  "/cozoro/trainer/router/:id/delete",
  requireAdminAuth,
  express.urlencoded({ extended: false }),
  async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.redirect("/cozoro/trainer?router_error=invalid");
      return;
    }

    const result = await deleteRouterTrainingExample(id);
    if (!result.deleted) {
      res.redirect("/cozoro/trainer?router_error=not_found");
      return;
    }

    res.redirect("/cozoro/trainer?router_deleted=1");
  }
);

app.get("/cozoro/dashboard", requireAdminAuth, async (req, res) => {
  const [chatRows, learningStatus, pendingLearnedEntries] = await Promise.all([
    readChatHistoryRows(1800),
    getLearningStatus(),
    getLearnedEntries({ status: "pending", limit: 60 })
  ]);
  const selectedConversation = String(req.query.conversation ?? "").trim();
  const grouped = new Map<string, ChatHistoryRow[]>();

  for (const row of chatRows) {
    const bucket = grouped.get(row.conversationKey) ?? [];
    bucket.push(row);
    grouped.set(row.conversationKey, bucket);
  }

  const conversationItems = Array.from(grouped.entries())
    .map(([conversationKey, messages]) => {
      const sorted = messages.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const last = sorted[sorted.length - 1];
      return {
        conversationKey,
        channel: last?.channel ?? "unknown",
        messageCount: sorted.length,
        lastAt: last?.createdAt ?? "",
        summary: summarizeConversationVi(sorted)
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  const currentKey = selectedConversation || conversationItems[0]?.conversationKey || "";
  const currentMessages = (grouped.get(currentKey) ?? []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const session = getAdminSession(req);

  const totalConversations = conversationItems.length;
  const totalMessages = chatRows.length;
  const latestActivity = conversationItems[0]?.lastAt ?? "chưa có";

  const sidebar = conversationItems
    .slice(0, 120)
    .map((item) => {
      const active = item.conversationKey === currentKey;
      return `<a class="thread ${active ? "active" : ""}" href="/cozoro/dashboard?conversation=${encodeURIComponent(item.conversationKey)}">
        <div class="top">
          <strong>${escapeHtml(item.conversationKey)}</strong>
          <span>${escapeHtml(item.channel)}</span>
        </div>
        <div class="meta">${item.messageCount} tin • ${escapeHtml(item.lastAt)}</div>
        <div class="summary">${escapeHtml(item.summary)}</div>
      </a>`;
    })
    .join("");

  const messagesHtml = currentMessages
    .map((item) => {
      return `<div class="msg ${item.role}">
        <div class="meta">${escapeHtml(item.role)} • ${escapeHtml(item.createdAt)} • ${escapeHtml(item.source)}</div>
        <div class="text">${escapeHtml(item.text)}</div>
      </div>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cozoro Chat Dashboard</title>
    <style>
      :root {
        --bg: #f4ecdf;
        --panel: #fffaf2;
        --line: #dbcbb3;
        --ink: #1d2f22;
        --muted: #5a6b61;
        --accent: #1f6a42;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background: radial-gradient(circle at 0% 0%, rgba(237, 216, 179, 0.55), transparent 32%), var(--bg);
      }
      .shell { max-width: 1360px; margin: 0 auto; padding: 12px 10px 96px; }
      .bar {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .stats {
        display: flex;
        gap: 16px;
        color: var(--muted);
        font-size: 14px;
        flex-wrap: wrap;
      }
      .top-actions {
        display: flex;
        gap: 8px;
      }
      .logout button {
        border: 0;
        border-radius: 999px;
        padding: 8px 14px;
        background: var(--accent);
        color: #fff;
        font-weight: 700;
        cursor: pointer;
      }
      .mobile-dock {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
        background: rgba(255, 250, 242, 0.96);
        border-top: 1px solid var(--line);
        display: none;
        z-index: 60;
      }
      .mobile-dock-inner {
        max-width: 1360px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .mobile-dock a,
      .mobile-dock button {
        margin: 0;
        height: 42px;
        border: 1px solid #ccb99a;
        border-radius: 999px;
        background: #fff;
        color: #1e2f22;
        font: inherit;
        font-weight: 700;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .layout {
        margin-top: 12px;
        display: grid;
        grid-template-columns: 430px 1fr;
        gap: 12px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
      }
      .threads {
        max-height: calc(100vh - 140px);
        overflow: auto;
        padding: 10px;
      }
      .thread {
        display: block;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px;
        margin-bottom: 8px;
        text-decoration: none;
        color: inherit;
        background: #fff;
      }
      .thread.active {
        border-color: #8cb79d;
        background: #f0f8f3;
      }
      .thread .top {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .thread .meta {
        color: var(--muted);
        font-size: 12px;
        margin-top: 4px;
      }
      .thread .summary {
        margin-top: 7px;
        color: #2d4335;
        font-size: 13px;
        line-height: 1.45;
      }
      .learning-panel {
        margin-top: 12px;
        padding: 10px;
      }
      .learn-item {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px;
        margin-bottom: 8px;
        background: #fff;
      }
      .learn-meta {
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 6px;
      }
      .learn-q, .learn-a {
        font-size: 13px;
        line-height: 1.45;
        margin-bottom: 4px;
      }
      .learn-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }
      .learn-actions button {
        border: 0;
        border-radius: 999px;
        padding: 6px 10px;
        cursor: pointer;
        font-weight: 700;
      }
      .learn-actions .approve {
        background: #1f6a42;
        color: #fff;
      }
      .learn-actions .reject {
        background: #8c1d1d;
        color: #fff;
      }
      .chat {
        max-height: calc(100vh - 140px);
        overflow: auto;
        padding: 12px;
      }
      .msg {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 9px 10px;
        margin-bottom: 8px;
        background: #fff;
      }
      .msg.customer { border-left: 4px solid #295f95; }
      .msg.bot { border-left: 4px solid #94631a; }
      .msg.admin { border-left: 4px solid #1f6a42; }
      .msg .meta { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
      .msg .text { white-space: pre-wrap; line-height: 1.5; }
      @media (max-width: 980px) {
        .layout { grid-template-columns: 1fr; }
        .threads, .chat { max-height: unset; }
        .top-actions {
          display: none;
        }
        .mobile-dock {
          display: block;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="bar">
        <div>
          <strong>Cozoro Bot Dashboard</strong>
          <div class="stats">
            <span>Admin: ${escapeHtml(session?.username ?? "cozoro")}</span>
            <span>Hội thoại: ${totalConversations}</span>
            <span>Tin nhắn: ${totalMessages}</span>
            <span>Tri thức chờ duyệt: ${pendingLearnedEntries.length}</span>
            <span>Tri thức đã duyệt: ${learningStatus.approvedCount}</span>
            <span>Hoạt động mới nhất: ${escapeHtml(latestActivity)}</span>
          </div>
        </div>
        <div class="top-actions">
          <form class="logout" method="get" action="/cozoro/trainer">
            <button type="submit">Trainer</button>
          </form>
          <form class="logout" method="post" action="/cozoro/logout">
            <button type="submit">Đăng xuất</button>
          </form>
        </div>
      </section>
      <section class="layout">
        <aside class="card threads">
          ${sidebar || "<p>Chưa có lịch sử chat.</p>"}
          <section class="learning-panel">
            <h3 style="margin: 2px 0 10px;">Tri thức chờ duyệt</h3>
            ${
              pendingLearnedEntries.length
                ? pendingLearnedEntries
                    .map((entry) => {
                      return `<article class="learn-item">
                        <div class="learn-meta">${escapeHtml(entry.createdAt)} • ${escapeHtml(entry.channel)} • ${escapeHtml(entry.source)}</div>
                        <div class="learn-q"><strong>Q:</strong> ${escapeHtml(truncateText(entry.question, 180))}</div>
                        <div class="learn-a"><strong>A:</strong> ${escapeHtml(truncateText(entry.answer, 200))}</div>
                        <form method="post" action="/cozoro/learned/${encodeURIComponent(entry.id)}/status">
                          <input type="hidden" name="conversation" value="${escapeHtml(currentKey)}" />
                          <div class="learn-actions">
                            <button class="approve" type="submit" name="status" value="approved">Approve</button>
                            <button class="reject" type="submit" name="status" value="rejected">Reject</button>
                          </div>
                        </form>
                      </article>`;
                    })
                    .join("")
                : "<p style='color: var(--muted); margin: 0;'>Hiện không có mục pending.</p>"
            }
          </section>
        </aside>
        <section class="card chat">${messagesHtml || "<p>Chọn một hội thoại để xem nội dung.</p>"}</section>
      </section>
    </main>
    <nav class="mobile-dock" aria-label="Điều hướng nhanh">
      <div class="mobile-dock-inner">
        <a href="/cozoro/dashboard">Dashboard</a>
        <a href="/cozoro/trainer">Trainer</a>
        <form method="post" action="/cozoro/logout">
          <button type="submit">Đăng xuất</button>
        </form>
      </div>
    </nav>
  </body>
</html>`;

  res.type("html").send(html);
});

app.post("/knowledge/refresh", async (_req, res) => {
  const status = await knowledgeService.refresh();
  res.json(status);
});

app.post("/ask", express.json(), async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const answer = await answerCustomerQuestion(knowledgeService, question);
  res.json({
    question,
    answer,
    sources: knowledgeService.search(question)
  });
});

app.post("/prospect/ask", express.json(), async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  const conversationKey = String(req.body?.conversationKey ?? "").trim();
  const referralName = String(req.body?.referral?.name ?? "").trim();
  const referralPhone = String(req.body?.referral?.phone ?? "").trim();
  const asAdminCorrection = Boolean(req.body?.asAdminCorrection);
  const adminAuthor = String(req.body?.adminAuthor ?? "").trim();

  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  if (asAdminCorrection) {
    if (!conversationKey) {
      res.status(400).json({ error: "conversationKey is required for admin correction learning" });
      return;
    }

    const learned = await recordAdminReplyAndLearn({
      conversationKey,
      role: "admin",
      text: question,
      channel: "playground",
      source: "playground-admin-correction",
      adminAuthor: adminAuthor || undefined
    });

    if (learned.learned) {
      await knowledgeService.refresh();
      res.json({
        question,
        answer:
          "Cozoro đã học xong câu chỉnh sửa này rồi nha. Từ giờ bot sẽ ưu tiên dùng đáp án này khi gặp câu hỏi tương tự.",
        sources: []
      });
      return;
    }

    const reasonMap: Record<string, string> = {
      no_recent_customer_message:
        "Cozoro chưa thấy câu hỏi gần nhất trong đoạn chat này để ghép học. Quý khách/tester gửi câu hỏi trước rồi dạy lại ngay sau đó nhé.",
      bot_echo:
        "Cozoro nhận ra nội dung này trùng với phản hồi bot vừa gửi, nên không lưu để tránh tự học từ chính mình.",
      duplicate:
        "Cozoro đã có tri thức này rồi nên không cần lưu thêm lần nữa."
    };

    const learnReason = String((learned as { reason?: string }).reason ?? "");

    res.json({
      question,
      answer:
        reasonMap[learnReason] ??
        `Cozoro chưa lưu được lần này. Quý khách/tester vui lòng gửi một câu hỏi trước, rồi bật chế độ dạy bot và gửi câu trả lời chỉnh sửa ngay sau đó nhé.${learnReason ? ` (reason: ${learnReason})` : ""}`,
      sources: []
    });
    return;
  }

  if (conversationKey) {
    await recordCustomerMessage({
      conversationKey,
      role: "customer",
      text: question,
      channel: "playground",
      source: "playground-customer-message"
    });
  }

  if (conversationKey && questionRequestsHuman(question)) {
    await setHandoffActive(conversationKey, "playground-human-request");
    await markHandoffNoticed(conversationKey);
    const answer =
      'Dạ được nha quý khách. Cozoro đã chuyển quý khách sang bạn hỗ trợ người thật rồi ạ. Quý khách cứ nhắn nội dung cần tư vấn, Cozoro sẽ “đứng im xinh đẹp” chờ bạn staff vào hỗ trợ nha.';
    await recordBotReply({
      conversationKey,
      role: "bot",
      text: answer,
      channel: "playground",
      source: "playground-bot-handoff"
    });
    res.json({ question, answer, sources: [] });
    return;
  }

  if (conversationKey && (await isHandoffActive(conversationKey))) {
    const answer =
      "Cozoro đang chờ bạn hỗ trợ người thật vào trả lời cho quý khách nha. Quý khách cứ nhắn thêm thông tin (D7/D2, ở mấy tháng, sinh viên/NVYT) để staff chốt ưu đãi nhanh hơn ạ.";
    res.json({ question, answer, sources: [] });
    return;
  }

  const conversationContext = conversationKey
    ? formatConversationContext(
        (await getRecentConversationMessages(conversationKey, 10)).filter(
          (message) => !(message.role === "customer" && message.text.trim() === question.trim())
        )
      )
    : "";

  const answer = await answerCustomerQuestion(knowledgeService, question, {
    referral:
      referralName && referralPhone
        ? {
            name: referralName,
            phone: referralPhone
          }
        : undefined,
    conversationContext
  });

  if (conversationKey) {
    await recordBotReply({
      conversationKey,
      role: "bot",
      text: answer.slice(0, 1900),
      channel: "playground",
      source: "playground-bot-reply"
    });
  }

  res.json({
    question,
    answer,
    sources: knowledgeService.search(question)
  });
});

app.get("/webhooks/facebook", (req, res) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const verifyToken = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");

  if (mode === "subscribe" && verifyToken && verifyToken === config.facebookVerifyToken) {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).send("Forbidden");
});

app.post("/webhooks/facebook", jsonParser, async (req, res) => {
  const request = req as RawBodyRequest;
  const signatureHeader = req.header("x-hub-signature-256");

  if (!verifyFacebookSignature(request.rawBody, signatureHeader)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const body = req.body as MessengerWebhookBody;
  if (body.object !== "page") {
    res.status(400).json({ error: "Unsupported webhook object" });
    return;
  }

  res.status(200).json({ ok: true });

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id?.trim();
      const recipientId = event.recipient?.id?.trim();
      const messageText = event.message?.text?.trim();

      if (!messageText) {
        continue;
      }

      if (event.message?.is_echo) {
        if (recipientId) {
          try {
            await clearHandoff(recipientId);
            const learned = await recordAdminReplyAndLearn({
              conversationKey: recipientId,
              role: "admin",
              text: messageText,
              channel: "facebook",
              source: "facebook-admin-reply"
            });

            if (learned.learned) {
              await knowledgeService.refresh();
            }
          } catch (error) {
            console.error("[bot] Failed to learn from echoed page reply", error);
          }
        }

        continue;
      }

      if (!senderId) {
        continue;
      }

      try {
        await recordCustomerMessage({
          conversationKey: senderId,
          role: "customer",
          text: messageText,
          channel: "facebook",
          source: "facebook-customer-message"
        });

        if (questionRequestsHuman(messageText)) {
          await setHandoffActive(senderId, "facebook-human-request");
          await markHandoffNoticed(senderId);
          const answer =
            "Dạ được nha quý khách. Cozoro đã chuyển quý khách sang bạn hỗ trợ người thật rồi ạ. Quý khách cứ nhắn nhu cầu (chi nhánh D7/D2, ở mấy tháng, sinh viên/NVYT) để staff chốt ưu đãi tốt nhất giúp mình nha.";
          await sendMessengerTextMessage({
            recipientId: senderId,
            text: answer.slice(0, 1900)
          });
          await recordBotReply({
            conversationKey: senderId,
            role: "bot",
            text: answer.slice(0, 1900),
            channel: "facebook",
            source: "facebook-bot-handoff"
          });
          continue;
        }

        if (await isHandoffActive(senderId)) {
          // During handoff we stop bot replies to avoid interrupting the human staff.
          continue;
        }

        const conversationContext = formatConversationContext(
          (await getRecentConversationMessages(senderId, 10)).filter(
            (message) => !(message.role === "customer" && message.text.trim() === messageText.trim())
          )
        );

        const answer = await answerCustomerQuestion(knowledgeService, messageText, {
          conversationContext
        });
        await sendMessengerTextMessage({
          recipientId: senderId,
          text: answer.slice(0, 1900)
        });
        await recordBotReply({
          conversationKey: senderId,
          role: "bot",
          text: answer.slice(0, 1900),
          channel: "facebook",
          source: "facebook-bot-reply"
        });
      } catch (error) {
        console.error("[bot] Failed to handle incoming message", error);
      }
    }
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[bot] Unhandled request error", error);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  await knowledgeService.refresh();

  app.listen(config.port, () => {
    console.log(`[bot] Listening on ${config.publicBaseUrl} (port ${config.port})`);
    console.log(`[bot] Knowledge documents: ${knowledgeService.getStatus().documentCount}`);
    console.log(`[bot] Knowledge chunks: ${knowledgeService.getStatus().chunkCount}`);
  });

  if (config.knowledgeRefreshIntervalMs > 0) {
    setInterval(() => {
      void knowledgeService.refresh().catch((error) => {
        console.error("[bot] Knowledge refresh failed", error);
      });
    }, config.knowledgeRefreshIntervalMs);
  }
}

void start().catch((error) => {
  console.error("[bot] Failed to start", error);
  process.exit(1);
});
