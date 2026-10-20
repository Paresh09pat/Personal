'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { FolderHeart, ImagePlus, Images, Plus, Trash2 } from 'lucide-react';
import { api, relUrl } from '@/lib/api';
import { useSection } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { uploadToSpace } from '@/lib/upload';
import { useSpace } from '@/components/SpaceShell';
import { MediaThumb, useLightbox } from '@/components/Media';
import { useToast } from '@/components/Toast';
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, Spinner, Textarea, cx } from '@/components/ui';

function UploadButton({ rid, onDone }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pick = async (files) => {
    setBusy(true);
    let ok = 0;
    for (const f of files) {
      try {
        await uploadToSpace(rid, f, { purpose: 'gallery' });
        ok += 1;
      } catch (err) {
        toast(`${f.name}: ${err.message}`, { tone: 'error' });
      }
    }
    setBusy(false);
    if (ok) toast(`${ok} added to your gallery 📸`);
    onDone();
  };
  return (
    <label className={cx('inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-accent px-5 font-medium text-accent-ink shadow-soft hover:brightness-110', busy && 'pointer-events-none opacity-60')}>
      <ImagePlus className="h-4 w-4" /> {busy ? 'Uploading…' : 'Add photos'}
      <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pick([...e.target.files])} />
    </label>
  );
}

function AlbumModal({ rid, album, photos, onClose }) {
  const queryClient = useQueryClient();
  const { open, lightbox } = useLightbox();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.section(rid, 'albums') });
  const inAlbum = new Set(album.attachmentIds);

  const add = async () => {
    await api.post(relUrl(rid, `/albums/${album.id}/items`), { attachmentIds: [...picked] });
    setPicked(new Set());
    setAdding(false);
    refresh();
  };
  const removeItem = async (id) => {
    await api.delete(relUrl(rid, `/albums/${album.id}/items/${id}`));
    refresh();
  };
  const deleteAlbum = async () => {
    if (!confirm('Delete this album? The photos stay in your gallery.')) return;
    await api.delete(relUrl(rid, `/albums/${album.id}`));
    refresh();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={album.title} wide>
      {album.description && <p className="mb-4 text-ink-soft">{album.description}</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-4 w-4" /> {adding ? 'Cancel' : 'Add from gallery'}
        </Button>
        <Button size="sm" variant="ghost" onClick={deleteAlbum}>
          <Trash2 className="h-4 w-4" /> Delete album
        </Button>
      </div>
      {adding ? (
        <>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {photos.filter((p) => !inAlbum.has(p.id)).map((p) => (
              <button
                key={p.id}
                onClick={() => setPicked((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
                className={cx('relative aspect-square overflow-hidden rounded-xl ring-4', picked.has(p.id) ? 'ring-accent' : 'ring-transparent')}
              >
                <MediaThumb a={p} className="pointer-events-none h-full w-full" />
              </button>
            ))}
          </div>
          <Button className="mt-4" disabled={!picked.size} onClick={add}>
            Add {picked.size} to album
          </Button>
        </>
      ) : album.media.length ? (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {album.media.map((m) => (
            <div key={m.id} className="group relative aspect-square">
              <MediaThumb a={m} onOpen={open} className="h-full w-full rounded-xl" />
              <button onClick={() => removeItem(m.id)} className="absolute right-1.5 top-1.5 hidden rounded-full bg-black/50 p-1.5 text-white group-hover:block" aria-label="Remove from album">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={FolderHeart} title="An empty album">Add your favourite moments from the gallery.</EmptyState>
      )}
      {lightbox}
    </Modal>
  );
}

export default function GalleryPage() {
  const { rid, writable, me } = useSpace();
  const queryClient = useQueryClient();
  const { open, lightbox } = useLightbox();
  const [tab, setTab] = useState('photos');
  const [openAlbum, setOpenAlbum] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '' });
  const [error, setError] = useState(null);

  const photosQuery = useInfiniteQuery({
    queryKey: qk.section(rid, 'gallery'),
    queryFn: ({ pageParam }) => api.get(relUrl(rid, `/attachments?limit=60${pageParam ? `&before=${pageParam}` : ''}`)),
    initialPageParam: null,
    getNextPageParam: (last) => (last.hasMore ? last.attachments[last.attachments.length - 1]?.id : undefined),
  });
  const photos = (photosQuery.data?.pages ?? []).flatMap((p) => p.attachments);
  const albums = useSection(rid, 'albums');
  const refreshPhotos = () => queryClient.invalidateQueries({ queryKey: qk.section(rid, 'gallery') });

  const createAlbum = async (e) => {
    e.preventDefault();
    try {
      await api.post(relUrl(rid, '/albums'), form);
      setForm({ title: '', description: '' });
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: qk.section(rid, 'albums') });
    } catch (err) {
      setError(err);
    }
  };

  const removePhoto = async (p) => {
    if (!confirm('Delete this from your shared gallery?')) return;
    await api.delete(relUrl(rid, `/attachments/${p.id}`));
    refreshPhotos();
  };

  const albumItem = openAlbum && albums.data?.items.find((a) => a.id === openAlbum);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="glass inline-flex rounded-full p-1">
          {[['photos', 'All photos', Images], ['albums', 'Albums', FolderHeart]].map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={cx('inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium', tab === k ? 'bg-accent text-accent-ink' : 'text-ink-soft')}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {writable && tab === 'photos' && <UploadButton rid={rid} onDone={refreshPhotos} />}
          {writable && tab === 'albums' && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New album
            </Button>
          )}
        </div>
      </div>

      {tab === 'photos' &&
        (photosQuery.isLoading ? (
          <Spinner />
        ) : photos.length === 0 ? (
          <Card>
            <EmptyState icon={Images} title="Your gallery is waiting">Photos and videos you share here, or in chat, live only in this space.</EmptyState>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
              {photos.map((p) => (
                <div key={p.id} className="group relative aspect-square">
                  <MediaThumb a={p} onOpen={open} className="h-full w-full rounded-xl" />
                  {writable && p.uploaderId === me.userId && (
                    <button onClick={() => removePhoto(p)} className="absolute right-1.5 top-1.5 hidden rounded-full bg-black/50 p-1.5 text-white group-hover:block" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {photosQuery.hasNextPage && (
              <div className="mt-4 text-center">
                <Button variant="outline" loading={photosQuery.isFetchingNextPage} onClick={() => photosQuery.fetchNextPage()}>
                  Load more
                </Button>
              </div>
            )}
          </>
        ))}

      {tab === 'albums' &&
        (albums.isLoading ? (
          <Spinner />
        ) : albums.data?.items.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {albums.data.items.map((a) => (
              <button key={a.id} onClick={() => setOpenAlbum(a.id)} className="glass overflow-hidden rounded-3xl text-left">
                <div className="aspect-[4/3] bg-accent-soft">
                  {a.media[0] && <MediaThumb a={a.media[0]} className="pointer-events-none h-full w-full" />}
                </div>
                <div className="p-4">
                  <p className="font-display text-xl">{a.title}</p>
                  <p className="text-xs text-muted">{a.media.length} item{a.media.length === 1 ? '' : 's'}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState icon={FolderHeart} title="No albums yet">Group your photos into little chapters.</EmptyState>
          </Card>
        ))}

      <Modal open={creating} onClose={() => setCreating(false)} title="New album">
        <form onSubmit={createAlbum} className="space-y-4">
          <Field label="Title">
            <Input required maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Summer in Goa" />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit">Create album</Button>
        </form>
      </Modal>
      {albumItem && <AlbumModal rid={rid} album={albumItem} photos={photos} onClose={() => setOpenAlbum(null)} />}
      {lightbox}
    </div>
  );
}
