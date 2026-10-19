"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink, KeyRound, Plus } from "lucide-react";
import type { AppProject, Environment, UntiedKey } from "@birdsi/shared";
import { addProjectAction, connectProjectKeyAction, editProjectAction, removeProjectAction, removeProjectKeyAction, renameAppAction, reuseKeyAction, setEnvironmentsAction, tieKeyAction } from "@/lib/actions";
import { ButtonArc } from "../Arc";
import { Toast } from "../Toast";
import { TwoStepButton } from "../TwoStep";
import { safeUrl } from "../format";
import { icon, icon14 } from "../icon";

/** The vendor list the forms need, passed down from the server so client code never imports the server catalog. */
export interface VendorChoice {
  vendor: string;
  name: string;
  reads: boolean;
  keyHint: string;
  keyUrl: string | null;
  kinds: Array<{ kind: string; refLabel: string; refHint: string }>;
  settings: Array<{ key: string; label: string; hint: string; required: boolean }>;
}

const ENVIRONMENTS: Environment[] = ["production", "preview", "development"];

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
      {message}
    </p>
  );
}

export function AppNameForm({ repoId, name }: { repoId: string; name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = value.trim() !== name && value.trim().length > 0;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return;
        start(async () => {
          setError(null);
          const r = await renameAppAction(repoId, value);
          if (!r.ok) setError(r.message);
          else router.refresh();
        });
      }}
    >
      <div className="field" style={{ minWidth: 240 }}>
        <label htmlFor="app-name">App name</label>
        <input id="app-name" className="input" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} disabled={pending} />
      </div>
      <button type="submit" className="btn btn-secondary btn-sm" disabled={!changed || pending}>
        {pending && <ButtonArc />}
        Rename
      </button>
      <ErrorLine message={error} />
    </form>
  );
}

export function EnvironmentsForm({ repoId, environments }: { repoId: string; environments: Environment[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Environment[]>(environments);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = picked.slice().sort().join() !== environments.slice().sort().join();
  return (
    <fieldset className="flex flex-col gap-2" style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="t-small" style={{ fontWeight: 500, paddingBottom: 6 }}>
        Environments birdsI checks
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        {ENVIRONMENTS.map((env) => {
          const on = picked.includes(env);
          return (
            <button key={env} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} disabled={pending} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== env) : [...p, env]))} style={{ minHeight: 32 }}>
              {env}
            </button>
          );
        })}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!changed || picked.length === 0 || pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await setEnvironmentsAction(repoId, picked);
              if (!r.ok) setError(r.message);
              else router.refresh();
            })
          }
        >
          {pending && <ButtonArc />}
          Save
        </button>
      </div>
      <ErrorLine message={error} />
    </fieldset>
  );
}

/** Paste a key for one project. birdsI proves it reads the project before storing it, encrypted. */
function KeyForm({ repoId, project, vendor, onDone, onCancel }: { repoId: string; project: AppProject; vendor: VendorChoice; onDone: () => void; onCancel: () => void }) {
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const url = safeUrl(vendor.keyUrl);
  return (
    <form
      className="panel slide-in-down flex flex-col gap-3.5"
      style={{ padding: "18px 20px", maxWidth: 560 }}
      aria-label={`Key for ${vendor.name} ${project.label ?? project.ref}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!token.trim()) return;
        start(async () => {
          setError(null);
          const r = await connectProjectKeyAction(repoId, project.id, { token, label });
          if (!r.ok) {
            setError(r.message);
            return;
          }
          setToken("");
          onDone();
        });
      }}
    >
      <p className="t-small c2">
        {vendor.keyHint}
        {url && (
          <>
            {" "}
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: "var(--text)" }}>
              Make a key
              <ExternalLink {...icon14} />
            </a>
          </>
        )}
      </p>
      <div className="field">
        <label htmlFor={`key-${project.id}`}>Key</label>
        <input id={`key-${project.id}`} type="password" className="input mono" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} autoFocus disabled={pending} />
      </div>
      <div className="field">
        <label htmlFor={`key-label-${project.id}`}>
          Label <span className="c3" style={{ fontWeight: 400 }}>(optional, for example: read, expires March)</span>
        </label>
        <input id={`key-label-${project.id}`} className="input" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} disabled={pending} />
      </div>
      <ErrorLine message={error} />
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!token.trim() || pending}>
          {pending && <ButtonArc />}
          {pending ? "Checking the key" : "Connect key"}
        </button>
      </div>
    </form>
  );
}

/** One project's controls: its key (connect, reuse, replace, remove) and the project itself. */
export function ProjectActions({ repoId, project, vendor, reusable }: { repoId: string; project: AppProject; vendor: VendorChoice | null; reusable: Array<{ connectionId: string; label: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canRead = Boolean(vendor?.reads);
  return (
    <div className="flex flex-col gap-3">
      {open && vendor && <KeyForm repoId={repoId} project={project} vendor={vendor} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); setNotice("Key connected. birdsI is reading the project now."); router.refresh(); }} />}
      {!open && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex flex-wrap items-center gap-2">
            <TwoStepButton
              label="Remove project"
              prompt={`Remove ${project.label ?? project.ref} from this app?`}
              detail="birdsI forgets the project and deletes its key. The project itself is not touched at the vendor."
              confirmLabel="Remove"
              cancelLabel="Keep it"
              style={{ fontSize: 13, minHeight: 32 }}
              onConfirm={async () => {
                const r = await removeProjectAction(repoId, project.id);
                return r.ok ? { ok: true } : { ok: false, message: r.message };
              }}
              onDone={() => router.refresh()}
            />
            {project.key && (
              <TwoStepButton
                label="Remove key"
                prompt="Remove this key?"
                detail="birdsI deletes the key and stops reading this project. Revoke it at the vendor too if nothing else uses it."
                confirmLabel="Remove key"
                cancelLabel="Keep it"
                style={{ fontSize: 13, minHeight: 32 }}
                onConfirm={async () => {
                  const r = await removeProjectKeyAction(repoId, project.id);
                  return r.ok ? { ok: true } : { ok: false, message: r.message };
                }}
                onDone={() => router.refresh()}
              />
            )}
          </span>
          {canRead && (
            <span className="inline-flex flex-wrap items-center gap-2">
              {!project.key && reusable.length > 0 && (
                <select
                  className="input"
                  aria-label="Use a key this app already has"
                  defaultValue=""
                  disabled={pending}
                  style={{ minHeight: 36, width: "auto", fontSize: 13 }}
                  onChange={(e) => {
                    const from = e.target.value;
                    if (!from) return;
                    start(async () => {
                      setError(null);
                      const r = await reuseKeyAction(repoId, project.id, from);
                      if (!r.ok) setError(r.message);
                      else {
                        setNotice("Key connected. birdsI is reading the project now.");
                        router.refresh();
                      }
                    });
                  }}
                >
                  <option value="">Use the key of</option>
                  {reusable.map((r) => (
                    <option key={r.connectionId} value={r.connectionId}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className={project.key ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"} onClick={() => setOpen(true)} disabled={pending}>
                {pending ? <ButtonArc /> : <KeyRound {...icon} />}
                {project.key ? "Replace key" : "Connect key"}
              </button>
            </span>
          )}
        </div>
      )}
      <ErrorLine message={error} />
      {notice && <Toast onClose={() => setNotice(null)}>{notice}</Toast>}
    </div>
  );
}

/** Label, environment and plan of a project, edited in place. */
export function ProjectDetailsForm({ repoId, project }: { repoId: string; project: AppProject }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(project.label ?? "");
  const [environment, setEnvironment] = useState<string>(project.environment ?? "");
  const [plan, setPlan] = useState(project.plan ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(true)} style={{ minHeight: 32, fontSize: 13 }}>
        Edit
      </button>
    );
  }
  return (
    <form
      className="panel slide-in-down flex flex-col gap-3"
      style={{ padding: "16px 18px", maxWidth: 520 }}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await editProjectAction(repoId, project.id, { label, environment, plan });
          if (!r.ok) setError(r.message);
          else {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <div className="field">
        <label htmlFor={`label-${project.id}`}>Label</label>
        <input id={`label-${project.id}`} className="input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} disabled={pending} placeholder="product, ops, schools" />
      </div>
      <div className="field">
        <label htmlFor={`env-${project.id}`}>Environment</label>
        <select id={`env-${project.id}`} className="input" value={environment} onChange={(e) => setEnvironment(e.target.value)} disabled={pending}>
          <option value="">Every environment</option>
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`plan-${project.id}`}>
          Plan <span className="c3" style={{ fontWeight: 400 }}>(only when the account does not say it)</span>
        </label>
        <input id={`plan-${project.id}`} className="input" value={plan} maxLength={60} onChange={(e) => setPlan(e.target.value)} disabled={pending} placeholder="Free, Pro" />
      </div>
      <ErrorLine message={error} />
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending && <ButtonArc />}
          Save
        </button>
      </div>
    </form>
  );
}

/** Declare a vendor project the app has: which vendor, what kind, its id, and the owner's label for it. */
export function AddProjectForm({ repoId, vendors, suggested }: { repoId: string; vendors: VendorChoice[]; suggested: string[] }) {
  const router = useRouter();
  const [vendorSlug, setVendorSlug] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [ref, setRef] = useState("");
  const [label, setLabel] = useState("");
  const [environment, setEnvironment] = useState("");
  const [plan, setPlan] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const vendor = vendors.find((v) => v.vendor === vendorSlug) ?? null;
  const spec = vendor?.kinds.find((k) => k.kind === kind) ?? vendor?.kinds[0] ?? null;

  const reset = () => {
    setVendorSlug(null);
    setKind("");
    setRef("");
    setLabel("");
    setEnvironment("");
    setPlan("");
    setSettings({});
    setError(null);
  };

  if (!vendor) {
    const ordered = [...vendors].sort((a, b) => Number(suggested.includes(b.vendor)) - Number(suggested.includes(a.vendor)) || a.name.localeCompare(b.name));
    return (
      <div className="flex flex-col gap-2.5">
        <span className="t-small c2">Add a project:</span>
        <div className="flex flex-wrap gap-2">
          {ordered.map((v) => (
            <button key={v.vendor} type="button" className={`chip${suggested.includes(v.vendor) ? " on" : ""}`} onClick={() => setVendorSlug(v.vendor)} style={{ minHeight: 32 }}>
              <Plus {...icon14} />
              {v.name}
            </button>
          ))}
        </div>
        {done && <Toast onClose={() => setDone(false)}>Project added.</Toast>}
      </div>
    );
  }

  return (
    <form
      className="panel slide-in-down flex flex-col gap-3.5"
      style={{ padding: "20px 22px", maxWidth: 560 }}
      aria-labelledby="add-project-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (!spec || !ref.trim()) return;
        start(async () => {
          setError(null);
          const r = await addProjectAction(repoId, { vendor: vendor.vendor, kind: spec.kind, ref, label, environment, plan, settings });
          if (!r.ok) {
            setError(r.message);
            return;
          }
          reset();
          setDone(true);
          router.refresh();
        });
      }}
    >
      <h3 id="add-project-title" className="t-h3">
        Add a {vendor.name} project
      </h3>
      {vendor.kinds.length > 1 && (
        <div className="field">
          <label htmlFor="project-kind">What it is</label>
          <select id="project-kind" className="input" value={spec?.kind ?? ""} onChange={(e) => setKind(e.target.value)} disabled={pending}>
            {vendor.kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.refLabel}
              </option>
            ))}
          </select>
        </div>
      )}
      {spec && (
        <div className="field">
          <label htmlFor="project-ref">{spec.refLabel}</label>
          <input id="project-ref" className="input mono" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" spellCheck={false} autoFocus disabled={pending} aria-describedby="project-ref-hint" />
          <span id="project-ref-hint" className="t-small c3">
            {spec.refHint}
          </span>
        </div>
      )}
      {vendor.settings.map((f) => (
        <div key={f.key} className="field">
          <label htmlFor={`project-${f.key}`}>
            {f.label}
            {!f.required && <span className="c3" style={{ fontWeight: 400 }}> (optional)</span>}
          </label>
          <input id={`project-${f.key}`} className="input mono" value={settings[f.key] ?? ""} onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))} autoComplete="off" spellCheck={false} disabled={pending} aria-describedby={`project-${f.key}-hint`} />
          <span id={`project-${f.key}-hint`} className="t-small c3">
            {f.hint}
          </span>
        </div>
      ))}
      <div className="grid grid-cols-1 gap-3.5 min-[701px]:grid-cols-2">
        <div className="field">
          <label htmlFor="project-label">
            Label <span className="c3" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <input id="project-label" className="input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} disabled={pending} placeholder="product, ops" />
        </div>
        <div className="field">
          <label htmlFor="project-env">Environment</label>
          <select id="project-env" className="input" value={environment} onChange={(e) => setEnvironment(e.target.value)} disabled={pending}>
            <option value="">Every environment</option>
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="project-plan">
          Plan <span className="c3" style={{ fontWeight: 400 }}>(optional, only when the account does not say it)</span>
        </label>
        <input id="project-plan" className="input" value={plan} maxLength={60} onChange={(e) => setPlan(e.target.value)} disabled={pending} placeholder="Free, Pro" />
      </div>
      {!vendor.reads && <p className="t-small c3">birdsI cannot read {vendor.name} yet. The project is kept with a link to its dashboard, and birdsI holds no key for it.</p>}
      <ErrorLine message={error} />
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn btn-secondary btn-sm" onClick={reset} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!ref.trim() || pending}>
          {pending && <ButtonArc />}
          Add project
        </button>
      </div>
    </form>
  );
}

/** A key from before keys were tied to projects, and the project of this app it can be tied to. */
export function TieKeyControl({ repoId, untied, projects }: { repoId: string; untied: UntiedKey; projects: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (projects.length === 0) return <p className="t-small c3">Add the {untied.vendorName} project this key reads, then tie it here.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={pending} style={{ minHeight: 36, width: "auto" }} aria-label={`Project for the ${untied.vendorName} key`}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!projectId || pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await tieKeyAction(repoId, untied.id, projectId);
            if (!r.ok) setError(r.message);
            else router.refresh();
          })
        }
      >
        {pending && <ButtonArc />}
        Tie to this project
      </button>
      <ErrorLine message={error} />
    </div>
  );
}
