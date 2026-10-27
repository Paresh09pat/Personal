'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Camera, Crown, Download, HeartCrack, ImagePlus, LogOut, ShieldCheck, ShieldOff, Timer, Trash2, Undo2, UserMinus } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { clearSpaceCache } from '@/lib/spaceCache';
import { toDateInput } from '@/lib/format';
import { CHAT_THEME_PRESETS, DISAPPEAR_PRESETS, THEME_GROUPS, THEME_ICON, chatBackgroundStyle, describeSeconds, themeFx, themeSwatch, themeVars } from '@/lib/chatThemes';
import { ThemeFx } from '@/components/ThemeFx';
import { uploadToSpace } from '@/lib/upload';
import { useSpace } from '@/components/SpaceShell';
import { useToast } from '@/components/Toast';
import { InvitePanel } from '@/components/InvitePanel';
import { ConfirmWithPassword } from '@/components/ConfirmWithPassword';
import { Avatar, Button, Card, ErrorText, Field, Input, Select, cx } from '@/components/ui';

const ACCENTS = { rose: '#c2185b', wine: '#8e2443', lavender: '#7c5cbf', gold: '#b8860b', ocean: '#1e6f8f' };

function Section({ title, children, className }) {
  return (
    <Card className={cx('space-y-4', className)}>
      <h2 className="font-display text-3xl">{title}</h2>
      {children}
    </Card>
  );
}

export default function SettingsPage() {
  const { rid, space, me, isGroup, members } = useSpace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const editable = ['pending', 'active'].includes(space.status);
  const [shared, setShared] = useState({
    title: space.title,
    anniversaryDate: toDateInput(space.anniversaryDate),
    accent: space.preferences?.accent ?? 'rose',
    showTyping: space.preferences?.showTyping !== false,
    showReadReceipts: space.preferences?.showReadReceipts !== false,
  });
  const [mine, setMine] = useState({ displayName: me.ownDisplayName ?? '', ...me.notificationPrefs });
  const prefs = space.preferences ?? {};
  const [theme, setTheme] = useState({
    theme: prefs.theme ?? 'classic',
    themeAnimated: prefs.themeAnimated !== false,
    wallpaperDim: prefs.wallpaperDim ?? 25,
    wallpaperAttachmentId: prefs.wallpaperAttachmentId ?? null,
    wallpaperUrl: space.wallpaperUrl ?? null,
  });
  const currentTimer = prefs.disappearAfterSec ?? 0;
  const isPreset = DISAPPEAR_PRESETS.some((p) => p.sec === currentTimer);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const [custom, setCustom] = useState(() => {
    if (!currentTimer || isPreset) return { n: 2, unit: 3600 };
    const unit = currentTimer % 86400 === 0 ? 86400 : currentTimer % 3600 === 0 ? 3600 : 60;
    return { n: currentTimer / unit, unit };
  });
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'end' | 'delete' | 'deletePending'
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.relDetail(rid) });
    queryClient.invalidateQueries({ queryKey: qk.relationships });
  };
  const run = async (fn, okMessage) => {
    setError(null);
    try {
      await fn();
      refresh();
      if (okMessage) toast(okMessage);
    } catch (err) {
      setError(err);
    }
  };

  const saveShared = (e) => {
    e.preventDefault();
    run(
      () =>
        api.patch(relUrl(rid), {
          title: shared.title,
          anniversaryDate: shared.anniversaryDate || null,
          preferences: { accent: shared.accent, showTyping: shared.showTyping, showReadReceipts: shared.showReadReceipts },
        }),
      'Saved 💗',
    );
  };
  const saveMine = (e) => {
    e.preventDefault();
    const { displayName, ...prefs } = mine;
    run(() => api.patch(relUrl(rid, '/me'), { displayName, notificationPrefs: prefs }), 'Saved 💗');
  };
  const saveTheme = () =>
    run(
      () =>
        api.patch(relUrl(rid), {
          preferences: {
            theme: theme.theme,
            themeAnimated: theme.themeAnimated,
            wallpaperDim: theme.wallpaperDim,
            wallpaperAttachmentId: theme.wallpaperAttachmentId,
          },
        }),
      'Chat theme saved for both of you 🎨',
    );
  const pickWallpaper = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await run(async () => {
      const a = await uploadToSpace(rid, file, { purpose: 'wallpaper' });
      setTheme((t) => ({ ...t, theme: 'custom', wallpaperAttachmentId: a.id, wallpaperUrl: a.url }));
    });
  };
  const setTimer = (sec) =>
    run(
      () => api.patch(relUrl(rid), { preferences: { disappearAfterSec: sec } }),
      sec ? `Messages now disappear after ${describeSeconds(sec)}` : 'Disappearing messages are off',
    );
  const applyCustom = () => {
    const sec = Math.round(Number(custom.n) * custom.unit);
    if (!(sec >= 60 && sec <= 30 * 86400)) return setError(new Error('Choose between 1 minute and 30 days'));
    return setTimer(sec);
  };
  const uploadImage = (purpose) => async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await run(async () => {
      const a = await uploadToSpace(rid, file, { purpose });
      if (purpose === 'avatar') await api.patch(relUrl(rid, '/me'), { avatarAttachmentId: a.id });
      else await api.patch(relUrl(rid), { coverAttachmentId: a.id });
    }, 'Photo updated');
  };

  const exportSpace = async () => {
    const res = await fetch(relUrl(rid, '/export'), { credentials: 'same-origin' });
    if (!res.ok) return toast('Export failed — try again later', { tone: 'error' });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `our-little-world-${rid}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const setRole = (userId, role) =>
    run(() => api.patch(relUrl(rid, `/members/${userId}`), { role }), role === 'admin' ? 'Now an admin' : 'No longer an admin');
  const removeMember = (m) => {
    if (!confirm(`Remove ${m.displayName} from this group? They won't be able to rejoin with an old link.`)) return;
    run(() => api.delete(relUrl(rid, `/members/${m.userId}`)), `${m.displayName} was removed`);
  };
  const leaveGroup = async () => {
    if (!confirm('Leave this group? You can only come back with a new invite link.')) return;
    try {
      await api.post(relUrl(rid, '/leave'));
      leave();
    } catch (err) {
      setError(err);
    }
  };

  const leave = () => {
    clearSpaceCache(queryClient, rid);
    queryClient.invalidateQueries({ queryKey: qk.relationships });
    router.replace('/dashboard');
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title={isGroup ? 'Group' : 'This space'}>
        <form onSubmit={saveShared} className="space-y-4">
          <div className="relative h-28 overflow-hidden rounded-2xl bg-gradient-to-br from-accent to-gold">
            {space.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- private media
              <img src={space.coverUrl} alt="" className="h-full w-full object-cover" />
            )}
            {editable && (
              <label className="absolute bottom-2 right-2 cursor-pointer rounded-full bg-black/50 px-3 py-1 text-xs text-white">
                {isGroup ? 'Change group photo' : 'Change cover'}
                <input type="file" accept="image/*" hidden onChange={uploadImage('cover')} />
              </label>
            )}
          </div>
          <Field label={isGroup ? 'Group name' : 'Name of this space'}>
            <Input disabled={!editable} maxLength={140} value={shared.title} onChange={(e) => setShared({ ...shared, title: e.target.value })} />
          </Field>
          {!isGroup && (
            <Field label="Anniversary" hint="Used for your days-together counter.">
              <Input disabled={!editable} type="date" value={shared.anniversaryDate} onChange={(e) => setShared({ ...shared, anniversaryDate: e.target.value })} />
            </Field>
          )}
          <Field label="Colour">
            <div className="flex gap-2">
              {Object.entries(ACCENTS).map(([k, color]) => (
                <button key={k} type="button" disabled={!editable} onClick={() => setShared({ ...shared, accent: k })} style={{ background: color }} className={cx('h-9 w-9 rounded-full ring-offset-2 ring-offset-surface-solid', shared.accent === k && 'ring-2 ring-ink')} aria-label={k} />
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!editable} checked={shared.showTyping} onChange={(e) => setShared({ ...shared, showTyping: e.target.checked })} /> Show typing indicator
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!editable} checked={shared.showReadReceipts} onChange={(e) => setShared({ ...shared, showReadReceipts: e.target.checked })} /> Show read receipts
          </label>
          {editable && <Button type="submit">Save</Button>}
        </form>
      </Section>

      <Section title={isGroup ? 'You, in this group' : 'You, in this space'}>
        <form onSubmit={saveMine} className="space-y-4">
          <div className="flex items-center gap-4">
            {space.status !== 'ended' ? (
              <label className="relative cursor-pointer" aria-label="Change profile photo">
                <Avatar name={me.displayName} src={me.avatarUrl} size={72} />
                <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-ink shadow-soft">
                  <Camera className="h-4 w-4" />
                </span>
                <input type="file" accept="image/*" hidden onChange={uploadImage('avatar')} />
              </label>
            ) : (
              <Avatar name={me.displayName} src={me.avatarUrl} size={72} />
            )}
            {space.status !== 'ended' && (
              <label className="cursor-pointer text-sm font-medium text-accent hover:underline">
                Change photo
                <input type="file" accept="image/*" hidden onChange={uploadImage('avatar')} />
              </label>
            )}
          </div>
          <Field label="Your name here" hint="Only shown inside this space.">
            <Input maxLength={60} value={mine.displayName} onChange={(e) => setMine({ ...mine, displayName: e.target.value })} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink-soft">Notifications</legend>
            {[
              ['muted', 'Mute this space'],
              ['messages', 'New messages'],
              ['activity', 'Notes, letters, memories & surprises'],
              ['calls', 'Incoming calls'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(mine[k])} onChange={(e) => setMine({ ...mine, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </fieldset>
          {space.status !== 'ended' && <Button type="submit">Save</Button>}
        </form>
      </Section>

      {isGroup && (
        <Section title={`Members (${members.length})`} className="lg:col-span-2">
          <ul className="divide-y divide-line">
            {members.map((m) => {
              const isOwnerRow = m.role === 'owner';
              const adminRow = m.role === 'owner' || m.role === 'admin';
              const canManage = me.isAdmin && !m.isMe && !isOwnerRow && (!adminRow || me.role === 'owner');
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar name={m.displayName} src={m.avatarUrl} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {m.displayName}
                      {m.isMe && <span className="text-muted"> (you)</span>}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted">
                      {isOwnerRow ? (
                        <>
                          <Crown className="h-3 w-3 text-gold" /> Owner
                        </>
                      ) : adminRow ? (
                        <>
                          <ShieldCheck className="h-3 w-3 text-accent" /> Admin
                        </>
                      ) : (
                        'Member'
                      )}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      {m.role === 'member' && (
                        <Button size="sm" variant="soft" onClick={() => setRole(m.userId, 'admin')}>
                          <ShieldCheck className="h-4 w-4" /> Make admin
                        </Button>
                      )}
                      {m.role === 'admin' && me.role === 'owner' && (
                        <Button size="sm" variant="ghost" onClick={() => setRole(m.userId, 'member')}>
                          <ShieldOff className="h-4 w-4" /> Remove admin
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="!text-danger" onClick={() => removeMember(m)}>
                        <UserMinus className="h-4 w-4" /> Remove
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {isGroup && me.isAdmin && editable && (
        <Section title="Invite people" className="lg:col-span-2">
          <InvitePanel rid={rid} kind="group" />
        </Section>
      )}

      {editable && (
        <Section title="Chat theme" className="lg:col-span-2">
          <p className="-mt-2 text-sm text-muted">One look for this chat: you both see it, and either of you can change it.</p>
          <div className="grid gap-5 md:grid-cols-[1fr_240px]">
            <div className="space-y-4">
              {THEME_GROUPS.map((group) => (
                <div key={group}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{group}</p>
                  <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                    {Object.entries(CHAT_THEME_PRESETS)
                      .filter(([, p]) => p.group === group)
                      .map(([key, p]) => (
                        <button key={key} type="button" onClick={() => setTheme({ ...theme, theme: key })} className="group space-y-1 text-center" aria-pressed={theme.theme === key}>
                          <span
                            className={cx('flex aspect-square items-center justify-center rounded-2xl text-3xl ring-offset-2 ring-offset-surface-solid transition group-hover:scale-105', theme.theme === key && 'ring-2 ring-accent')}
                            style={{ background: themeSwatch(key) }}
                          >
                            {THEME_ICON[key]}
                          </span>
                          <span className="block text-xs text-ink-soft">{p.label}</span>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Your own photo</p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="group cursor-pointer space-y-1 text-center">
                    <span
                      className={cx('flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-accent text-accent ring-offset-2 ring-offset-surface-solid transition group-hover:scale-105', theme.theme === 'custom' && 'ring-2 ring-accent')}
                      style={theme.wallpaperUrl ? { backgroundImage: `url("${theme.wallpaperUrl}")`, backgroundSize: 'cover' } : undefined}
                    >
                      {!theme.wallpaperUrl && <ImagePlus className="h-6 w-6" />}
                    </span>
                    <span className="block text-xs text-ink-soft">{theme.wallpaperUrl ? 'Change photo' : 'Upload'}</span>
                    <input type="file" accept="image/*" hidden onChange={pickWallpaper} />
                  </label>
                  {theme.theme === 'custom' && theme.wallpaperUrl && (
                    <label className="min-w-48 flex-1 space-y-1">
                      <span className="text-sm font-medium text-ink-soft">Darken photo ({theme.wallpaperDim}%)</span>
                      <input type="range" min={0} max={70} step={5} value={theme.wallpaperDim} onChange={(e) => setTheme({ ...theme, wallpaperDim: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
                    </label>
                  )}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={theme.themeAnimated} onChange={(e) => setTheme({ ...theme, themeAnimated: e.target.checked })} /> Animated background (hearts, stars, snow…)
              </label>
              <Button type="button" onClick={saveTheme}>Apply for both of us</Button>
            </div>
            <div
              className="relative mx-auto h-[340px] w-full max-w-[240px] self-start overflow-hidden rounded-3xl border border-line md:sticky md:top-0"
              style={{ ...chatBackgroundStyle({ theme: theme.theme, wallpaperDim: theme.wallpaperDim }, theme.wallpaperUrl), ...themeVars({ theme: theme.theme }) }}
              aria-label="Preview"
            >
              <ThemeFx type={themeFx({ theme: theme.theme, themeAnimated: theme.themeAnimated })} />
              <div className="relative z-[1] space-y-2 p-3">
                <p className="bubble-them w-fit max-w-[80%] rounded-2xl rounded-bl-md px-3 py-1.5 text-sm">Miss you already</p>
                <p className="bubble-me ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md px-3 py-1.5 text-sm">Good morning 💗</p>
                <p className="bubble-them w-fit max-w-[80%] rounded-2xl rounded-bl-md px-3 py-1.5 text-sm">Call me tonight?</p>
                <p className="bubble-me ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md px-3 py-1.5 text-sm">Always 😘</p>
              </div>
            </div>
          </div>
        </Section>
      )}

      {editable && (
        <Section title="Disappearing messages" className="lg:col-span-2">
          <p className="-mt-2 flex items-start gap-2 text-sm text-muted">
            <Timer className="mt-0.5 h-4 w-4 shrink-0" /> New messages (and their photos, videos and voice notes) vanish for both of you after the time you choose. Either of you can change it. Messages already sent keep their old timer.
          </p>
          <div className="flex flex-wrap gap-2">
            {DISAPPEAR_PRESETS.map((p) => (
              <button
                key={p.sec}
                type="button"
                onClick={() => {
                  setCustomOpen(false);
                  setTimer(p.sec);
                }}
                aria-pressed={!customOpen && currentTimer === p.sec}
                className={cx('rounded-full border px-4 py-2 text-sm font-medium transition', !customOpen && currentTimer === p.sec ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink-soft hover:border-accent hover:text-accent')}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomOpen(true)}
              aria-pressed={customOpen}
              className={cx('rounded-full border px-4 py-2 text-sm font-medium transition', customOpen ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink-soft hover:border-accent hover:text-accent')}
            >
              Custom{!isPreset && currentTimer ? `: ${describeSeconds(currentTimer)}` : ''}
            </button>
          </div>
          {customOpen && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="w-28 space-y-1">
                <span className="text-sm font-medium text-ink-soft">After</span>
                <Input type="number" min={1} max={43200} value={custom.n} onChange={(e) => setCustom({ ...custom, n: e.target.value })} />
              </label>
              <label className="w-36 space-y-1">
                <span className="text-sm font-medium text-ink-soft">Unit</span>
                <Select value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: Number(e.target.value) })}>
                  <option value={60}>minutes</option>
                  <option value={3600}>hours</option>
                  <option value={86400}>days</option>
                </Select>
              </label>
              <Button type="button" onClick={applyCustom}>Set timer</Button>
            </div>
          )}
          <p className="text-sm text-ink-soft">
            Now: <strong>{currentTimer ? `messages disappear after ${describeSeconds(currentTimer)}` : 'off, messages stay forever'}</strong>
          </p>
        </Section>
      )}

      {!isGroup && space.status === 'pending' && me.role === 'owner' && (
        <Section title="Invitation" className="lg:col-span-2">
          <InvitePanel rid={rid} />
        </Section>
      )}

      <Section title="Your data & this space" className="lg:col-span-2">
        <ErrorText error={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          {space.status !== 'pending' && (
            <Button variant="outline" onClick={exportSpace}>
              <Download className="h-4 w-4" /> Export this space (JSON)
            </Button>
          )}
          {isGroup && (
            <Button variant="outline" className="!text-danger" onClick={leaveGroup}>
              <LogOut className="h-4 w-4" /> Leave group
            </Button>
          )}
          {isGroup && me.isAdmin && (
            <Button variant="danger" onClick={() => setDialog('deletePending')}>
              <Trash2 className="h-4 w-4" /> Delete group for everyone
            </Button>
          )}
          {!isGroup && space.status === 'active' && (
            <Button variant="outline" onClick={() => run(() => api.post(relUrl(rid, '/archive')), 'Space archived')}>
              <Archive className="h-4 w-4" /> Archive (read-only)
            </Button>
          )}
          {!isGroup && space.status === 'archived' && (
            <Button variant="outline" onClick={() => run(() => api.post(relUrl(rid, '/unarchive')), 'Welcome back 💗')}>
              <ArchiveRestore className="h-4 w-4" /> Unarchive
            </Button>
          )}
          {!isGroup && ['active', 'archived'].includes(space.status) && (
            <Button variant="outline" className="!text-danger" onClick={() => setDialog('end')}>
              <HeartCrack className="h-4 w-4" /> End this relationship space
            </Button>
          )}
          {!isGroup && space.status === 'ended' && !space.deletionRequestedByMe && (
            <Button variant="danger" onClick={() => setDialog('delete')}>
              <Trash2 className="h-4 w-4" /> Request permanent deletion
            </Button>
          )}
          {!isGroup && space.status === 'ended' && space.deletionRequestedByMe && (
            <Button variant="outline" onClick={() => run(() => api.delete(relUrl(rid, '/deletion-request')), 'Deletion request withdrawn')}>
              <Undo2 className="h-4 w-4" /> Withdraw my deletion request
            </Button>
          )}
          {space.status === 'pending' && me.role === 'owner' && (
            <Button variant="danger" onClick={() => setDialog('deletePending')}>
              <Trash2 className="h-4 w-4" /> Delete this space
            </Button>
          )}
        </div>
        {!isGroup && space.status === 'ended' && (
          <p className="text-sm text-muted">
            Permanent deletion happens only when both of you request it.{' '}
            {space.deletionRequestedByPartner ? 'Your partner has already requested it.' : ''}
          </p>
        )}
      </Section>

      <ConfirmWithPassword
        open={dialog === 'end'}
        onClose={() => setDialog(null)}
        title="End this space?"
        phrase="END"
        actionLabel="End space"
        description={
          <>
            <p>The space becomes read-only for both of you. Nothing is deleted: you can both still read and export everything.</p>
            <p>This cannot be undone, but you can always start a new space together later.</p>
          </>
        }
        onConfirm={async (body) => {
          await api.post(relUrl(rid, '/end'), body);
          refresh();
        }}
      />
      <ConfirmWithPassword
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title="Permanently delete?"
        phrase="DELETE"
        actionLabel="Request deletion"
        description={<p>When both of you have requested it, every message, photo, letter and memory in this space is erased forever. Export first if you want a copy.</p>}
        onConfirm={async (body) => {
          const res = await api.post(relUrl(rid, '/deletion-request'), body);
          if (res.purged) leave();
          else refresh();
        }}
      />
      <ConfirmWithPassword
        open={dialog === 'deletePending'}
        onClose={() => setDialog(null)}
        title={isGroup ? 'Delete this group?' : 'Delete this waiting space?'}
        phrase="DELETE"
        actionLabel="Delete"
        description={
          isGroup ? (
            <p>Every message, photo and memory in this group is erased for everyone, forever. Export first if you want a copy.</p>
          ) : (
            <p>Nobody has joined yet, so this simply removes the space and its invitation.</p>
          )
        }
        onConfirm={async (body) => {
          await api.delete(relUrl(rid), body);
          leave();
        }}
      />
    </div>
  );
}
