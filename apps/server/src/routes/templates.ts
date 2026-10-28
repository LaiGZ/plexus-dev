import { TemplatePreviewInput } from "@plexus/contracts";
import { Hono } from "hono";
import { APP_TEMPLATE, parseAppTemplate, templatePreview } from "../domain/source/template.js";
import { requireAuth } from "../http/auth.js";
import { readJson } from "../http/validate.js";
import type { AppEnv } from "../types.js";

export const templateRoutes = new Hono<AppEnv>();

/** Downloadable creation template (YAML with comments). */
templateRoutes.get("/app", (c) => {
  return c.body(APP_TEMPLATE, 200, {
    "content-type": "text/yaml; charset=utf-8",
    "content-disposition": 'attachment; filename="plexus-app-template.yaml"',
  });
});

/** Validate a template and return what the wizard should prefill. */
templateRoutes.post("/app/preview", async (c) => {
  requireAuth(c);
  const body = await readJson(c, TemplatePreviewInput);
  const template = parseAppTemplate(body.text);
  return c.json(templatePreview(template));
});
