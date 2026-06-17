import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { StatusTimeline, type Step } from "../components/StatusTimeline.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import type { IClosedResult, IClosedProgress } from "../../electron/ipc.js";
import type { Campaign, CampaignLink } from "../../src/types.js";

const campaignUrlFor = (hash: string) => `https://dev.iclosed.io/campaign?plan_hash=${hash}`;

// Ported from the module's renderer.js generatePassword: 12 chars, >=1 of each
// class, shuffled (Fisher–Yates).
function generatePassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*?";
  const all = upper + lower + digits + special;
  const rand = (set: string) => set[Math.floor(Math.random() * set.length)];
  const required = [rand(upper), rand(lower), rand(digits), rand(special)];
  const rest = Array.from({ length: length - required.length }, () => rand(all));
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

type RunState = "idle" | "running" | "success" | "error";

// Module-level form cache: survives tab switches (the page remounts) but is
// reset when the app restarts (module reloads), so a fresh launch loads the
// latest defaults rather than the previous session's picks.
const sessionForm = {
  campaignUrl: "",
  selectedCampaign: "",
  selectedLink: "",
  emailMode: "random" as "random" | "custom",
  email: "",
  password: "Demo@123",
  headless: true,
  closeWhenDone: false,
};

export function CreateUser({ profile }: { profile: string }) {
  // Selections persist within the session (across tab switches) via sessionForm.
  const [campaignUrl, setCampaignUrl] = useState(sessionForm.campaignUrl);

  // Campaigns dropdown — lazy: fetched fresh each time it's opened.
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState(sessionForm.selectedCampaign); // campaign id

  // Campaign Link dropdown — fetched from the back-office API for the selected campaign.
  const [links, setLinks] = useState<CampaignLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState(sessionForm.selectedLink); // hash

  async function loadCampaigns() {
    setLoadingCampaigns(true); setCampaignsError(null);
    const r = await api.listCampaigns(profile);
    setLoadingCampaigns(false);
    if (!r.ok) { setCampaignsError(r.error); return; }
    setCampaigns(r.data);
    // Default-select the latest (first) campaign if nothing is chosen yet.
    if (!selectedCampaign && r.data.length > 0) onPickCampaign(String(r.data[0].id));
  }

  async function loadLinks(campaignId: string) {
    if (!campaignId) return;
    setLoadingLinks(true); setLinksError(null);
    const r = await api.listCampaignLinks(profile, Number(campaignId));
    setLoadingLinks(false);
    if (!r.ok) { setLinksError(r.error); setLinks([]); return; }
    setLinks(r.data);
    // Default-select the first link and fill the URL (if none chosen / URL empty).
    if (r.data.length > 0 && !selectedLink) onPickLink(r.data[0].hash, !campaignUrl);
  }

  // Initial load: populate campaigns; if a campaign was previously selected, also
  // load its links so the saved Campaign Link shows. Otherwise default to latest.
  useEffect(() => {
    loadCampaigns();
    if (selectedCampaign) loadLinks(selectedCampaign);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [profile]);

  function onPickCampaign(id: string) {
    setSelectedCampaign(id);
    setSelectedLink(""); setLinks([]); setLinksError(null);
    loadLinks(id);
  }

  function onPickLink(hash: string, setUrl = true) {
    setSelectedLink(hash);
    if (hash && setUrl) setCampaignUrl(campaignUrlFor(hash));
  }
  const [emailMode, setEmailMode] = useState<"random" | "custom">(sessionForm.emailMode);
  const [email, setEmail] = useState(sessionForm.email);
  const [password, setPassword] = useState(sessionForm.password);
  const [headless, setHeadless] = useState(sessionForm.headless);
  const [closeWhenDone, setCloseWhenDone] = useState(sessionForm.closeWhenDone);

  // Mirror selections/inputs into the module cache so they survive tab switches.
  useEffect(() => {
    Object.assign(sessionForm, { campaignUrl, selectedCampaign, selectedLink, emailMode, email, password, headless, closeWhenDone });
  }, [campaignUrl, selectedCampaign, selectedLink, emailMode, email, password, headless, closeWhenDone]);

  const [state, setState] = useState<RunState>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<IClosedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(
    () =>
      api.onIClosedProgress((p: IClosedProgress) => {
        if (p.step?.startsWith("DBG")) return; // skip debug dumps
        setSteps((s) => [...s, { step: p.step, message: p.detail ?? (p.error ? p.error : "") }]);
      }),
    [],
  );

  const running = state === "running";
  const canRun = !running && campaignUrl.trim() !== "" && password.trim() !== "" && (emailMode === "random" || email.trim() !== "");

  async function run() {
    setState("running"); setSteps([]); setResult(null); setError(null);
    const res = await api.createIClosedUser({
      campaignUrl: campaignUrl.trim(),
      emailMode,
      email: emailMode === "custom" ? email.trim() : undefined,
      password,
      headed: !headless,
      keepOpen: !closeWhenDone,
    });
    if (!res.ok) { setError(res.error); setState("error"); return; }
    setResult(res.data); setState("success");
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(label); setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">Create iClosed user</h1>

      <label className="block max-w-md">
        <span className="mb-1 block text-sm text-slate-400">Campaign</span>
        <SearchableSelect
          options={campaigns.map((c) => ({ label: c.name, value: String(c.id) }))}
          value={selectedCampaign}
          onChange={onPickCampaign}
          onOpen={loadCampaigns}
          loading={loadingCampaigns}
          disabled={running}
          placeholder="Select a campaign…"
        />
      </label>
      {campaignsError && <Banner kind="error" title="Couldn't load campaigns">{campaignsError}</Banner>}

      <label className="block max-w-md">
        <span className="mb-1 block text-sm text-slate-400">Campaign Link</span>
        <SearchableSelect
          options={links.map((l) => ({ label: l.label, value: l.hash }))}
          value={selectedLink}
          onChange={(h) => onPickLink(h)}
          onOpen={() => loadLinks(selectedCampaign)}
          loading={loadingLinks}
          disabled={running || !selectedCampaign}
          placeholder={selectedCampaign ? "Select a campaign link…" : "Pick a campaign first"}
        />
      </label>
      {linksError && <Banner kind="error" title="Couldn't load campaign links">{linksError}</Banner>}

      <Field label="Campaign URL" value={campaignUrl} onChange={setCampaignUrl}
        placeholder="https://dev.iclosed.io/campaign?plan_hash=…" />

      <div className="space-y-2">
        <span className="block text-sm text-slate-400">Email</span>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={emailMode === "random"} onChange={() => setEmailMode("random")} disabled={running} />
            Random
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={emailMode === "custom"} onChange={() => setEmailMode("custom")} disabled={running} />
            User-Defined
          </label>
        </div>
        {emailMode === "custom" && (
          <Field label="" value={email} onChange={setEmail} placeholder="user@example.com" />
        )}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1"><Field label="Password" value={password} onChange={setPassword} /></div>
        <button onClick={() => setPassword(generatePassword())} disabled={running}
          className="rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800 disabled:opacity-50">
          Regenerate
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-400">Browser mode</span>
          <select value={headless ? "headless" : "headed"} onChange={(e) => setHeadless(e.target.value === "headless")} disabled={running}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
            <option value="headless">Headless</option>
            <option value="headed">Headed</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
          <input type="checkbox" checked={closeWhenDone} onChange={(e) => setCloseWhenDone(e.target.checked)} disabled={running} />
          Close browser when done
        </label>
      </div>

      <button disabled={!canRun} onClick={run}
        className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">
        {running ? "Creating…" : "Create"}
      </button>

      {steps.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <StatusTimeline steps={steps} done={state === "success"} failed={state === "error"} />
        </div>
      )}

      {error && <Banner kind="error" title="Create failed">{error}</Banner>}

      {result && (
        <Banner kind="success" title="User created">
          <div className="mt-1 space-y-1">
            {([
              ["Email", result.email],
              ["Password", result.password],
              ["Username", result.username],
            ] as const).map(([label, value]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-24 text-slate-400">{label}</span>
                <span className="font-mono text-slate-100">{value}</span>
                <button onClick={() => copy(label, value)} className="text-xs text-sky-300 hover:underline">
                  {copied === label ? "copied" : "copy"}
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-24 text-slate-400">Workspace</span>
              <a href="#" onClick={(e) => { e.preventDefault(); api.openExternal(result.workspaceUrl); }}
                className="font-mono text-sky-300 hover:underline">{result.workspaceUrl}</a>
              <button onClick={() => copy("Workspace", result.workspaceUrl)} className="text-xs text-sky-300 hover:underline">
                {copied === "Workspace" ? "copied" : "copy"}
              </button>
            </div>
          </div>
        </Banner>
      )}
    </div>
  );
}
