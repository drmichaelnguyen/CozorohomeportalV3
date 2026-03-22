import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

type FeedbackPayload = {
  email?: string;
  page?: string;
  message?: string;
};

function sanitizeSegment(value: string) {
  return value.replace(/[^a-z0-9-_]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

const feedbackDir = path.join(process.cwd(), "feedback");
const feedbackLogPath = path.join(feedbackDir, "feedback.jsonl");
const MAX_FEEDBACK_ENTRIES = 200;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FeedbackPayload;
    const message = body.message?.trim() ?? "";
    const page = body.page?.trim() ?? "/";
    const email = body.email?.trim().toLowerCase() ?? "anonymous";

    if (!message) {
      return NextResponse.json({ error: "Feedback message is required." }, { status: 400 });
    }

    await mkdir(feedbackDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${timestamp}__${sanitizeSegment(email)}__${sanitizeSegment(page) || "home"}.json`;

    const payload = {
      email,
      page,
      message,
      createdAt: new Date().toISOString()
    };

    await appendFile(feedbackLogPath, `${JSON.stringify({ fileName, ...payload })}\n`, "utf8");

    return NextResponse.json({ ok: true, fileName });
  } catch {
    return NextResponse.json({ error: "Unable to save feedback right now." }, { status: 500 });
  }
}

export async function GET() {
  try {
    await mkdir(feedbackDir, { recursive: true });
    const raw = await readFile(feedbackLogPath, "utf8").catch(() => "");
    const entries = raw
      .split("\n")
      .filter(Boolean)
      .slice(-MAX_FEEDBACK_ENTRIES)
      .map((line) => {
        const payload = JSON.parse(line) as {
          fileName?: string;
          email?: string;
          page?: string;
          message?: string;
          createdAt?: string;
        };

        return {
          fileName: payload.fileName ?? "",
          email: payload.email ?? "anonymous",
          page: payload.page ?? "/",
          message: payload.message ?? "",
          createdAt: payload.createdAt ?? ""
        };
      });

    entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ error: "Unable to load feedback right now." }, { status: 500 });
  }
}
