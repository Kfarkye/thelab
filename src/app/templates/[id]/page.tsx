import { notFound } from "next/navigation";
import { resolveTemplate } from "@/lib/resolver/template-resolver";
import { TemplateViewClient, type TemplateViewModel } from "./TemplateViewClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

type TemplateBlueprint = {
  subject: string;
  body: string;
  to?: string;
  cc?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry)).filter(Boolean)
    : [];
}

function readBlueprint(value: unknown): TemplateBlueprint {
  const blueprint = asRecord(value);
  return {
    subject: readString(blueprint.subject),
    body: readString(blueprint.body),
    to: readString(blueprint.to) || undefined,
    cc: readString(blueprint.cc) || undefined,
  };
}

export default async function TemplateViewPage({ params }: Props) {
  const resolvedParams = await params;
  const templateId = readString(resolvedParams.id);

  if (!templateId) return notFound();

  const resolution = await resolveTemplate(templateId);

  if (resolution.status === "not_found" || resolution.status === "ambiguous") {
    return notFound();
  }

  const data = asRecord(resolution.data);
  const id = readString(data.id) || templateId;
  const encodedId = encodeURIComponent(id);
  const model: TemplateViewModel = {
    id,
    name: readString(data.name) || id,
    category: readString(data.category) || "template",
    messageType: readString(data.messageType) || "email",
    internalOnly: readBoolean(data.internalOnly),
    requiredFields: readStringList(data.requiredFields),
    source: readString(data.source) || "unknown",
    version: readNumber(data.version, 1),
    blueprint: readBlueprint(data.blueprint),
    urls: {
      page: `/templates/${encodedId}`,
      api: `/api/hub/templates/${encodedId}`,
      hubPostBody: JSON.stringify({ path: `templates/${id}` }, null, 2),
    },
  };

  return <TemplateViewClient template={model} />;
}
