import {
  AddToolInput,
  AppGrantsInput,
  CreateSourceInput,
  ImportApplyInput,
  ImportPreviewInput,
  PreviewSourceInput,
  UpdateSourceInput,
} from "@plexus/contracts";
import { Hono } from "hono";
import { previewSource } from "../domain/source/preview.js";
import {
  addTool,
  applyImport,
  createSource,
  deleteSource,
  getAppGrants,
  getSource,
  listSources,
  previewImport,
  setAppGrants,
  syncMcpTools,
  updateSource,
} from "../domain/source/service.js";
import { requireAuth } from "../http/auth.js";
import { readJson } from "../http/validate.js";
import type { AppEnv } from "../types.js";

export const sourceRoutes = new Hono<AppEnv>();

sourceRoutes.post("/preview", async (c) => {
  requireAuth(c);
  const body = await readJson(c, PreviewSourceInput);
  return c.json(await previewSource(body));
});

sourceRoutes.get("/", async (c) => {
  requireAuth(c);
  return c.json({ sources: await listSources() });
});

sourceRoutes.post("/", async (c) => {
  requireAuth(c);
  const body = await readJson(c, CreateSourceInput);
  return c.json(await createSource(body), 201);
});

sourceRoutes.get("/:id", async (c) => {
  requireAuth(c);
  return c.json(await getSource(c.req.param("id")));
});

sourceRoutes.patch("/:id", async (c) => {
  requireAuth(c);
  const body = await readJson(c, UpdateSourceInput);
  return c.json({ source: await updateSource(c.req.param("id"), body) });
});

sourceRoutes.delete("/:id", async (c) => {
  requireAuth(c);
  await deleteSource(c.req.param("id"));
  return c.body(null, 204);
});

sourceRoutes.post("/:id/tools", async (c) => {
  requireAuth(c);
  const body = await readJson(c, AddToolInput);
  return c.json({ tool: await addTool(c.req.param("id"), body) }, 201);
});

sourceRoutes.post("/:id/import/preview", async (c) => {
  requireAuth(c);
  const body = await readJson(c, ImportPreviewInput);
  return c.json(await previewImport(c.req.param("id"), body.text));
});

sourceRoutes.post("/:id/import", async (c) => {
  requireAuth(c);
  const body = await readJson(c, ImportApplyInput);
  const result = await applyImport(c.req.param("id"), body.text, body.removeMissing);
  return c.json(result, 201);
});

sourceRoutes.post("/:id/sync", async (c) => {
  requireAuth(c);
  return c.json(await syncMcpTools(c.req.param("id")));
});

sourceRoutes.get("/:id/grants", async (c) => {
  requireAuth(c);
  return c.json({ toolIds: await getAppGrants(c.req.param("id")) });
});

sourceRoutes.put("/:id/grants", async (c) => {
  requireAuth(c);
  const body = await readJson(c, AppGrantsInput);
  return c.json({ toolIds: await setAppGrants(c.req.param("id"), body.toolIds) });
});
