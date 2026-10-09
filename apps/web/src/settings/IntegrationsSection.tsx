// SPDX-License-Identifier: AGPL-3.0-only
// Personal API tokens, webhooks, and (for admins) bots and custom slash commands.
import { useEffect, useState } from 'react';
import { Bot, Copy, KeyRound, Plus, Terminal, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import type { ApiToken, SlashCommand, User, Webhook } from '@ocpc/shared';
import { api } from '../lib/api';
import { channelTitle, isDm, toast, toastError, useStore } from '../lib/store';
import { formatDateTime, formatRelative } from '../lib/format';
import { t } from '../lib/i18n';
import { Avatar, confirmDialog, copyText, Modal, Spinner } from '../components/ui';
import { ChannelPicker } from '../components/modals';

function Secret({ label, value, hint }: { label: string; value: string; hint?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="label" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div className="secret-box">
        <span className="grow">{value}</span>
        <button className="icon-btn icon-btn-sm" onClick={() => copyText(value).then(() => toast(t('Copied')))} aria-label={t('Copy')}>
          <Copy size={14} />
        </button>
      </div>
      {hint && <div className="faint small" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="secret-box" style={{ whiteSpace: 'pre-wrap', display: 'block' }}>
      {children}
    </pre>
  );
}

function ShownOnce({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          {t('Done')}
        </button>
      }
    >
      <p className="small" style={{ color: 'var(--warning)', fontWeight: 600 }}>
        {t('Copy this now — it will not be shown again.')}
      </p>
      {children}
    </Modal>
  );
}

const ORIGIN = typeof location !== 'undefined' ? location.origin : '';

// ---------- personal tokens ----------
function TokensCard() {
  const me = useStore((s) => s.me)!;
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [form, setForm] = useState<{ name: string; read: boolean; write: boolean; admin: boolean; days: string } | null>(null);
  const [created, setCreated] = useState<ApiToken | null>(null);
  const isAdmin = me.role === 'admin' || me.role === 'owner';
  const load = () => api.get<ApiToken[]>('/tokens').then(setTokens).catch(toastError);
  useEffect(() => {
    load();
  }, []);
  const create = async () => {
    if (!form) return;
    const scopes = (['read', 'write', 'admin'] as const).filter((s) => form[s]);
    try {
      const tok = await api.post<ApiToken>('/tokens', { name: form.name, scopes, expiresInDays: form.days ? Number(form.days) : null });
      setForm(null);
      setCreated(tok);
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const revoke = async (tok: ApiToken) => {
    if (!(await confirmDialog({ title: t('Revoke “{name}”?', { name: tok.name }), body: t('Anything using this token will stop working.'), confirmLabel: t('Revoke'), danger: true }))) return;
    await api.del(`/tokens/${tok.id}`).catch(toastError);
    load();
  };
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          <KeyRound size={16} style={{ verticalAlign: -3 }} /> {t('Personal API tokens')}
        </h3>
        <button className="btn btn-sm btn-primary" onClick={() => setForm({ name: '', read: true, write: true, admin: false, days: '' })}>
          <Plus size={14} /> {t('New token')}
        </button>
      </div>
      <p className="muted small">
        {t('Tokens let scripts act as you through the REST API.')}{' '}
        <a href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">
          {t('API reference (OpenAPI)')}
        </a>
      </p>
      {!tokens ? (
        <Spinner />
      ) : tokens.length === 0 ? (
        <p className="faint small">{t('No tokens yet.')}</p>
      ) : (
        <div className="list-card" style={{ margin: 0 }}>
          {tokens.map((tok) => (
            <div key={tok.id} className="list-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {tok.name}{' '}
                  {tok.scopes.map((s) => (
                    <span key={s} className="pill" style={{ marginLeft: 4 }}>
                      {s}
                    </span>
                  ))}
                </div>
                <div className="faint small">
                  {t('Created {when}', { when: formatDateTime(tok.createdAt) })}
                  {' · '}
                  {tok.lastUsedAt ? t('last used {when}', { when: formatRelative(tok.lastUsedAt) }) : t('never used')}
                  {tok.expiresAt && ` · ${t('expires {when}', { when: formatDateTime(tok.expiresAt) })}`}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => revoke(tok)}>
                {t('Revoke')}
              </button>
            </div>
          ))}
        </div>
      )}
      {form && (
        <Modal
          title={t('New API token')}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                {t('Cancel')}
              </button>
              <button className="btn btn-primary" onClick={create} disabled={!form.name.trim() || !(form.read || form.write || form.admin)}>
                {t('Create token')}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="tok-name">{t('Name')}</label>
            <input id="tok-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('e.g. Backup script')} maxLength={80} />
          </div>
          <div className="label" style={{ marginBottom: 6 }}>
            {t('Permissions')}
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={form.read} onChange={(e) => setForm({ ...form, read: e.target.checked })} /> <span><strong>read</strong> — {t('read messages, channels and people')}</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={form.write} onChange={(e) => setForm({ ...form, write: e.target.checked })} /> <span><strong>write</strong> — {t('post and change things as you')}</span>
          </label>
          {isAdmin && (
            <label className="checkbox">
              <input type="checkbox" checked={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} /> <span><strong>admin</strong> — {t('use administration endpoints')}</span>
            </label>
          )}
          <div className="field">
            <label htmlFor="tok-exp">{t('Expires')}</label>
            <select id="tok-exp" className="select" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}>
              <option value="">{t('Never')}</option>
              <option value="30">{t('In 30 days')}</option>
              <option value="90">{t('In 90 days')}</option>
              <option value="365">{t('In 1 year')}</option>
            </select>
          </div>
        </Modal>
      )}
      {created?.token && (
        <ShownOnce title={t('Token created')} onClose={() => setCreated(null)}>
          <Secret label={created.name} value={created.token} />
          <div className="label">{t('Try it')}</div>
          <Code>{`curl -H "Authorization: Bearer ${created.token}" ${ORIGIN}/api/v1/me`}</Code>
        </ShownOnce>
      )}
    </div>
  );
}

// ---------- webhooks ----------
function WebhooksCard() {
  const me = useStore((s) => s.me)!;
  const channels = useStore((s) => s.channels);
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [form, setForm] = useState<{ kind: 'incoming' | 'outgoing'; name: string; channelId: string | null; url: string; triggers: string } | null>(null);
  const [created, setCreated] = useState<Webhook | null>(null);
  const isAdmin = me.role === 'admin' || me.role === 'owner';
  const load = () => api.get<Webhook[]>('/webhooks').then(setHooks).catch(toastError);
  useEffect(() => {
    load();
  }, []);
  const where = (id: string) => {
    const c = channels[id];
    return c ? (isDm(c) ? channelTitle(c, me.id) : `#${c.name}`) : t('a channel you are not in');
  };
  const create = async () => {
    if (!form?.channelId) return;
    try {
      const hook = await api.post<Webhook>('/webhooks', {
        kind: form.kind,
        name: form.name,
        channelId: form.channelId,
        ...(form.kind === 'outgoing' ? { url: form.url, triggerWords: form.triggers.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      });
      setForm(null);
      setCreated(hook);
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const remove = async (h: Webhook) => {
    if (!(await confirmDialog({ title: t('Delete webhook “{name}”?', { name: h.name }), confirmLabel: t('Delete'), danger: true }))) return;
    await api.del(`/webhooks/${h.id}`).catch(toastError);
    load();
  };
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          <WebhookIcon size={16} style={{ verticalAlign: -3 }} /> {t('Webhooks')}
        </h3>
        <button className="btn btn-sm btn-primary" onClick={() => setForm({ kind: 'incoming', name: '', channelId: null, url: '', triggers: '' })}>
          <Plus size={14} /> {t('New webhook')}
        </button>
      </div>
      <p className="muted small">{t('Incoming webhooks let other tools post into a channel. Outgoing webhooks send channel messages to another service.')}</p>
      {!hooks ? (
        <Spinner />
      ) : hooks.length === 0 ? (
        <p className="faint small">{t('No webhooks yet.')}</p>
      ) : (
        <div className="list-card" style={{ margin: 0 }}>
          {hooks.map((h) => (
            <div key={h.id} className="list-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {h.name} <span className="pill">{h.kind === 'incoming' ? t('incoming') : t('outgoing')}</span>
                </div>
                <div className="faint small ellipsis">
                  {where(h.channelId)}
                  {h.url && ` → ${h.url}`}
                  {h.triggerWords.length > 0 && ` · ${t('triggers')}: ${h.triggerWords.join(', ')}`}
                </div>
              </div>
              <button className="icon-btn icon-btn-sm" onClick={() => remove(h)} aria-label={t('Delete {name}', { name: h.name })}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {form && (
        <Modal
          title={t('New webhook')}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                {t('Cancel')}
              </button>
              <button className="btn btn-primary" onClick={create} disabled={!form.name.trim() || !form.channelId || (form.kind === 'outgoing' && !form.url)}>
                {t('Create')}
              </button>
            </>
          }
        >
          {isAdmin && (
            <div className="field">
              <label htmlFor="wh-kind">{t('Type')}</label>
              <select id="wh-kind" className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'incoming' | 'outgoing' })}>
                <option value="incoming">{t('Incoming — post messages into a channel')}</option>
                <option value="outgoing">{t('Outgoing — send channel messages to a URL')}</option>
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="wh-name">{t('Name')}</label>
            <input id="wh-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('e.g. CI builds')} maxLength={80} />
            <span className="hint">{t('Shown as the sender name unless the payload sets "username".')}</span>
          </div>
          <div className="field">
            <label>{t('Channel')}</label>
            <ChannelPicker value={form.channelId} onChange={(id) => setForm({ ...form, channelId: id })} filter={(c) => !isDm(c)} />
          </div>
          {form.kind === 'outgoing' && (
            <>
              <div className="field">
                <label htmlFor="wh-url">{t('URL')}</label>
                <input id="wh-url" className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/hook" />
              </div>
              <div className="field">
                <label htmlFor="wh-tr">{t('Trigger words (optional)')}</label>
                <input id="wh-tr" className="input" value={form.triggers} onChange={(e) => setForm({ ...form, triggers: e.target.value })} placeholder="!deploy, !status" />
                <span className="hint">{t('Comma separated. Leave empty to send every message in the channel.')}</span>
              </div>
            </>
          )}
        </Modal>
      )}
      {created && (created.postUrl || created.secret) && (
        <ShownOnce title={t('Webhook created')} onClose={() => setCreated(null)}>
          {created.postUrl && (
            <>
              <Secret label={t('Webhook URL')} value={created.postUrl} hint={t('Anyone with this URL can post to the channel. Treat it like a password.')} />
              <div className="label">{t('Try it')}</div>
              <Code>{`curl -X POST -H "Content-Type: application/json" \\\n  -d '{"text": "Hello from a webhook"}' \\\n  ${created.postUrl}`}</Code>
            </>
          )}
          {created.secret && (
            <>
              <Secret label={t('Signing secret')} value={created.secret} />
              <p className="small">
                {t('Each request carries the headers X-OCPC-Timestamp and X-OCPC-Signature. Verify the signature as:')}
              </p>
              <Code>{'X-OCPC-Signature = "sha256=" + hex(HMAC_SHA256(secret, X-OCPC-Timestamp + "." + rawBody))'}</Code>
              <p className="small">{t('Reply with JSON {"text": "..."} to post a response in the channel.')}</p>
            </>
          )}
        </ShownOnce>
      )}
    </div>
  );
}

// ---------- bots (admins) ----------
type BotInfo = User & { ownerId: string | null; description: string };

function BotsCard() {
  const [bots, setBots] = useState<BotInfo[] | null>(null);
  const [form, setForm] = useState<{ username: string; displayName: string; description: string } | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const load = () => api.get<BotInfo[]>('/bots').then(setBots).catch(toastError);
  useEffect(() => {
    load();
  }, []);
  const create = async () => {
    if (!form) return;
    try {
      const r = await api.post<{ bot: User; token: ApiToken }>('/bots', form);
      setForm(null);
      setCreated({ name: r.bot.displayName, token: r.token.token! });
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const newToken = async (b: BotInfo) => {
    try {
      const tok = await api.post<ApiToken>(`/bots/${b.id}/tokens`, { name: `token-${new Date().toISOString().slice(0, 10)}`, scopes: ['read', 'write'], expiresInDays: null });
      setCreated({ name: b.displayName, token: tok.token! });
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          <Bot size={16} style={{ verticalAlign: -3 }} /> {t('Bots')}
        </h3>
        <button className="btn btn-sm btn-primary" onClick={() => setForm({ username: '', displayName: '', description: '' })}>
          <Plus size={14} /> {t('New bot')}
        </button>
      </div>
      <p className="muted small">{t('Bot accounts post with their own name and token. Add a bot to the channels it should work in.')}</p>
      {!bots ? (
        <Spinner />
      ) : bots.length === 0 ? (
        <p className="faint small">{t('No bots yet.')}</p>
      ) : (
        <div className="list-card" style={{ margin: 0 }}>
          {bots.map((b) => (
            <div key={b.id} className="list-item">
              <Avatar user={b} size={28} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {b.displayName} <span className="faint small">@{b.username}</span>
                </div>
                {b.description && <div className="faint small ellipsis">{b.description}</div>}
              </div>
              <button className="btn btn-sm" onClick={() => newToken(b)}>
                {t('New token')}
              </button>
            </div>
          ))}
        </div>
      )}
      {form && (
        <Modal
          title={t('New bot')}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                {t('Cancel')}
              </button>
              <button className="btn btn-primary" onClick={create} disabled={!form.username || !form.displayName}>
                {t('Create bot')}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="bot-un">{t('Username')}</label>
            <input id="bot-un" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} placeholder="deploybot" maxLength={32} />
          </div>
          <div className="field">
            <label htmlFor="bot-dn">{t('Display name')}</label>
            <input id="bot-dn" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="bot-desc">{t('What does it do?')}</label>
            <input id="bot-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} />
          </div>
        </Modal>
      )}
      {created && (
        <ShownOnce title={t('Bot token for {name}', { name: created.name })} onClose={() => setCreated(null)}>
          <Secret label={t('Token')} value={created.token} />
          <div className="label">{t('Post a message')}</div>
          <Code>{`curl -X POST -H "Authorization: Bearer ${created.token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"body": "Hello!"}' \\\n  ${ORIGIN}/api/v1/channels/CHANNEL_ID/messages`}</Code>
          <p className="small muted">{t('Realtime events: connect a WebSocket to {url}?token=TOKEN', { url: `${ORIGIN.replace(/^http/, 'ws')}/api/v1/ws` })}</p>
        </ShownOnce>
      )}
    </div>
  );
}

// ---------- slash commands (admins) ----------
type CommandRow = (SlashCommand & { builtin: false }) | { command: string; description: string; usageHint: string; builtin: true; id?: undefined };

function SlashCommandsCard() {
  const [commands, setCommands] = useState<CommandRow[] | null>(null);
  const [form, setForm] = useState<{ command: string; description: string; usageHint: string; url: string } | null>(null);
  const [created, setCreated] = useState<SlashCommand | null>(null);
  const load = () => api.get<CommandRow[]>('/commands').then(setCommands).catch(toastError);
  useEffect(() => {
    load();
  }, []);
  const create = async () => {
    if (!form) return;
    try {
      const c = await api.post<SlashCommand>('/slash-commands', { ...form, command: form.command.replace(/^\//, '') });
      setForm(null);
      setCreated(c);
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const remove = async (c: CommandRow) => {
    if (c.builtin) return;
    if (!(await confirmDialog({ title: t('Delete /{name}?', { name: c.command }), confirmLabel: t('Delete'), danger: true }))) return;
    await api.del(`/slash-commands/${c.id}`).catch(toastError);
    load();
  };
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          <Terminal size={16} style={{ verticalAlign: -3 }} /> {t('Slash commands')}
        </h3>
        <button className="btn btn-sm btn-primary" onClick={() => setForm({ command: '', description: '', usageHint: '', url: '' })}>
          <Plus size={14} /> {t('New command')}
        </button>
      </div>
      <p className="muted small">{t('Custom commands send what people type to your service, which can reply privately or in the channel.')}</p>
      {!commands ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Command')}</th>
                <th>{t('Description')}</th>
                <th>{t('Type')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {commands.map((c) => (
                <tr key={c.command}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <code>/{c.command}</code> <span className="faint small">{c.usageHint}</span>
                  </td>
                  <td className="small">{c.description}</td>
                  <td>
                    <span className="pill">{c.builtin ? t('built-in') : t('custom')}</span>
                  </td>
                  <td>
                    {!c.builtin && (
                      <button className="icon-btn icon-btn-sm" onClick={() => remove(c)} aria-label={t('Delete /{name}', { name: c.command })}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Modal
          title={t('New slash command')}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>
                {t('Cancel')}
              </button>
              <button className="btn btn-primary" onClick={create} disabled={!form.command || !form.url}>
                {t('Create')}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="sc-cmd">{t('Command')}</label>
            <input id="sc-cmd" className="input" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value.toLowerCase() })} placeholder="/weather" maxLength={33} />
          </div>
          <div className="field">
            <label htmlFor="sc-desc">{t('Description')}</label>
            <input id="sc-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="sc-hint">{t('Usage hint')}</label>
            <input id="sc-hint" className="input" value={form.usageHint} onChange={(e) => setForm({ ...form, usageHint: e.target.value })} placeholder="[city]" maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="sc-url">{t('Request URL')}</label>
            <input id="sc-url" className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/commands/weather" />
          </div>
        </Modal>
      )}
      {created?.secret && (
        <ShownOnce title={t('/{name} created', { name: created.command })} onClose={() => setCreated(null)}>
          <Secret label={t('Signing secret')} value={created.secret} hint={t('Requests are signed with X-OCPC-Timestamp and X-OCPC-Signature, like outgoing webhooks.')} />
          <div className="label">{t('Your service receives (POST, JSON)')}</div>
          <Code>{'{\n  "command": "/weather",\n  "text": "Berlin",\n  "user_id": "…",\n  "user_name": "alice",\n  "channel_id": "…",\n  "channel_name": "general",\n  "thread_root_id": null\n}'}</Code>
          <div className="label">{t('and replies with')}</div>
          <Code>{'{ "text": "☀️ 21°C in Berlin", "response_type": "ephemeral" | "in_channel", "username": "Weather" }'}</Code>
        </ShownOnce>
      )}
    </div>
  );
}

export function IntegrationsSection() {
  const me = useStore((s) => s.me)!;
  const isAdmin = me.role === 'admin' || me.role === 'owner';
  return (
    <>
      <TokensCard />
      {me.role !== 'guest' && <WebhooksCard />}
      {isAdmin && <BotsCard />}
      {isAdmin && <SlashCommandsCard />}
    </>
  );
}
