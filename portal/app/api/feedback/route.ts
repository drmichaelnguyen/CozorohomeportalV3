import { mkdir, writeFile } from "node:fs/promises";
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FeedbackPayload;
    const message = body.message?.trim() ?? "";
    const page = body.page?.trim() ?? "/";
    const email = body.email?.trim().toLowerCase() ?? "anonymous";

    if (!message) {
      return NextResponse.json({ error: "Feedback message is required." }, { status: 400 });
    }

    const feedbackDir = path.join(process.cwd(), "feedback");
    await mkdir(feedbackDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${timestamp}__${sanitizeSegment(email)}__${sanitizeSegment(page) || "home"}.json`;
    const filePath = path.join(feedbackDir, fileName);

    const payload = {
      email,
      page,
      message,
      createdAt: new Date().toISOString()
    };

    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    return NextResponse.json({ ok: true, fileName });
  } catch {
    return NextResponse.json({ error: "Unable to save feedback right now." }, { status: 500 });
  }
}
