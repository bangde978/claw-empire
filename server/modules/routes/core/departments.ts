import type { RuntimeContext } from "../../../types/runtime-context.ts";

export function registerDepartmentRoutes(ctx: RuntimeContext): void {
  const { app, db, broadcast, normalizeTextField, runInTransaction } = ctx;

  const PROTECTED_DEPARTMENT_IDS = new Set(["planning", "dev", "design", "qa", "devsecops", "operations"]);

  app.get("/api/departments", (_req, res) => {
    const departments = db
      .prepare(
        `
    SELECT d.*,
      (SELECT COUNT(*) FROM agents a WHERE a.department_id = d.id) AS agent_count
    FROM departments d
    ORDER BY d.sort_order ASC
  `,
      )
      .all();
    res.json({ departments });
  });

  app.get("/api/departments/:id", (req, res) => {
    const id = String(req.params.id);
    const department = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
    if (!department) return res.status(404).json({ error: "not_found" });

    const agents = db.prepare("SELECT * FROM agents WHERE department_id = ? ORDER BY role, name").all(id);
    res.json({ department, agents });
  });

  app.post("/api/departments", (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "invalid_payload" });
      }

      const id = normalizeTextField((body as any).id);
      const name = normalizeTextField((body as any).name);
      if (!id || !name) return res.status(400).json({ error: "id_and_name_required" });
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
        return res.status(400).json({ error: "invalid_department_id" });
      }

      const existing = db.prepare("SELECT id FROM departments WHERE id = ?").get(id);
      if (existing) return res.status(409).json({ error: "department_id_exists" });

      const nameKo = normalizeTextField((body as any).name_ko) ?? "";
      const nameJa = normalizeTextField((body as any).name_ja) ?? "";
      const nameZh = normalizeTextField((body as any).name_zh) ?? "";
      const icon = normalizeTextField((body as any).icon) ?? "📁";
      const colorInput = normalizeTextField((body as any).color);
      const color = colorInput && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorInput) ? colorInput : "#6b7280";
      const description = normalizeTextField((body as any).description);
      const prompt = normalizeTextField((body as any).prompt);

      const maxOrder = (db.prepare("SELECT MAX(sort_order) AS m FROM departments").get() as any)?.m ?? 0;
      try {
        db.prepare(
          "INSERT INTO departments (id, name, name_ko, name_ja, name_zh, icon, color, description, prompt, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, name, nameKo, nameJa, nameZh, icon, color, description || null, prompt || null, maxOrder + 1);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("idx_departments_sort_order") || msg.includes("departments.sort_order")) {
          return res.status(409).json({ error: "sort_order_conflict" });
        }
        throw err;
      }

      const dept = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
      broadcast("departments_changed", {});
      res.status(201).json({ department: dept });
    } catch (err) {
      console.error("[departments] POST failed:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  app.patch("/api/departments/:id", (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (id === "reorder") return next();
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "invalid_payload" });
      }
      const existing = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
      if (!existing) return res.status(404).json({ error: "not_found" });

      let nextSortOrder: number | undefined;
      if ((body as any).sort_order !== undefined) {
        const parsed = Number((body as any).sort_order);
        if (!Number.isInteger(parsed) || parsed < 0) {
          return res.status(400).json({ error: "invalid_sort_order" });
        }
        nextSortOrder = parsed;
        const conflict = db
          .prepare("SELECT id FROM departments WHERE sort_order = ? AND id != ?")
          .get(nextSortOrder, id);
        if (conflict) {
          return res.status(409).json({ error: "sort_order_conflict", conflicting_id: (conflict as any).id });
        }
      }

      const sets: string[] = [];
      const vals: any[] = [];

      if ((body as any).name !== undefined) {
        const value = normalizeTextField((body as any).name);
        if (!value) return res.status(400).json({ error: "invalid_name" });
        sets.push("name = ?");
        vals.push(value);
      }
      if ((body as any).name_ko !== undefined) {
        sets.push("name_ko = ?");
        vals.push(normalizeTextField((body as any).name_ko) ?? "");
      }
      if ((body as any).name_ja !== undefined) {
        sets.push("name_ja = ?");
        vals.push(normalizeTextField((body as any).name_ja) ?? "");
      }
      if ((body as any).name_zh !== undefined) {
        sets.push("name_zh = ?");
        vals.push(normalizeTextField((body as any).name_zh) ?? "");
      }
      if ((body as any).icon !== undefined) {
        const value = normalizeTextField((body as any).icon);
        if (!value) return res.status(400).json({ error: "invalid_icon" });
        sets.push("icon = ?");
        vals.push(value);
      }
      if ((body as any).color !== undefined) {
        const value = normalizeTextField((body as any).color);
        if (!value || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
          return res.status(400).json({ error: "invalid_color" });
        }
        sets.push("color = ?");
        vals.push(value);
      }
      if ((body as any).description !== undefined) {
        if ((body as any).description === null) {
          sets.push("description = ?");
          vals.push(null);
        } else {
          sets.push("description = ?");
          vals.push(normalizeTextField((body as any).description) || null);
        }
      }
      if ((body as any).prompt !== undefined) {
        if ((body as any).prompt === null) {
          sets.push("prompt = ?");
          vals.push(null);
        } else {
          sets.push("prompt = ?");
          vals.push(normalizeTextField((body as any).prompt) || null);
        }
      }
      if (nextSortOrder !== undefined) {
        sets.push("sort_order = ?");
        vals.push(nextSortOrder);
      }

      if (sets.length === 0) return res.status(400).json({ error: "no_fields" });
      vals.push(id);
      try {
        db.prepare(`UPDATE departments SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("idx_departments_sort_order") || msg.includes("departments.sort_order")) {
          return res.status(409).json({ error: "sort_order_conflict" });
        }
        throw err;
      }

      const dept = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
      broadcast("departments_changed", {});
      res.json({ department: dept });
    } catch (err) {
      console.error("[departments] PATCH failed:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  app.delete("/api/departments/:id", (req, res) => {
    try {
      const id = String(req.params.id);
      const existing = db.prepare("SELECT id FROM departments WHERE id = ?").get(id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      if (PROTECTED_DEPARTMENT_IDS.has(id)) {
        return res.status(403).json({ error: "department_protected" });
      }

      const agentCount =
        (db.prepare("SELECT COUNT(*) AS c FROM agents WHERE department_id = ?").get(id) as any)?.c ?? 0;
      if (agentCount > 0) return res.status(409).json({ error: "department_has_agents", agent_count: agentCount });
      const taskCount = (db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE department_id = ?").get(id) as any)?.c ?? 0;
      if (taskCount > 0) return res.status(409).json({ error: "department_has_tasks", task_count: taskCount });

      db.prepare("DELETE FROM departments WHERE id = ?").run(id);
      broadcast("departments_changed", {});
      res.json({ ok: true });
    } catch (err) {
      console.error("[departments] DELETE failed:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  app.patch("/api/departments/reorder", (req, res) => {
    try {
      const body = req.body;
      if (!body || !Array.isArray(body.orders)) {
        return res.status(400).json({ error: "orders_array_required" });
      }
      const orders = body.orders as Array<{ id: string; sort_order: number }>;
      for (const item of orders) {
        if (
          !item.id ||
          typeof item.sort_order !== "number" ||
          !Number.isInteger(item.sort_order) ||
          item.sort_order < 0
        ) {
          return res.status(400).json({ error: "invalid_order_entry", detail: item });
        }
      }

      runInTransaction(() => {
        const tempBase = 90000;
        const stmtTemp = db.prepare("UPDATE departments SET sort_order = ? WHERE id = ?");
        for (let i = 0; i < orders.length; i++) {
          stmtTemp.run(tempBase + i, orders[i].id);
        }

        const stmtFinal = db.prepare("UPDATE departments SET sort_order = ? WHERE id = ?");
        for (const item of orders) {
          stmtFinal.run(item.sort_order, item.id);
        }
      });
      broadcast("departments_changed", {});
      res.json({ ok: true });
    } catch (err) {
      console.error("[departments] PATCH reorder failed:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });
}
