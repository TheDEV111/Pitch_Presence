'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  POSITION_LABELS,
  PROFILE_PHOTO_MAX_BYTES,
  footballFields,
  type PlayerProfileResponse,
  type FootballFields,
} from '@pitchpresence/shared';
import { api } from '@/lib/api';
import { useResource } from './data';
import { Button, Feedback, Field, Loading, PageTitle, Status } from './ui';
import './player-profile.css';
type Position = keyof typeof POSITION_LABELS;
const coordinates: Record<Position, [number, number]> = {
  GK: [50, 91],
  CB: [50, 74],
  LB: [15, 74],
  RB: [85, 74],
  LWB: [15, 57],
  RWB: [85, 57],
  DM: [50, 60],
  CM: [50, 45],
  AM: [50, 29],
  LW: [15, 18],
  RW: [85, 18],
  ST: [50, 12],
};
export function PlayerAvatar({
  id,
  name,
  version,
  preview,
}: {
  id: string;
  name: string;
  version?: string | null;
  preview?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src =
    preview ?? (version ? `/api/v1/players/${id}/photo?v=${encodeURIComponent(version)}` : null);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className="player-photo">
      {/* Private cookie-authenticated media must bypass public image optimization. */}
      {src && !failed ? (
        <img src={src} alt={`${name}'s profile photo`} onError={() => setFailed(true)} />
      ) : (
        <span aria-label={`${name}, no profile photo`}>
          {name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')}
        </span>
      )}
    </span>
  );
}
function Pitch({ primary, secondary }: { primary: Position | null; secondary: Position[] }) {
  return (
    <div
      className="profile-pitch"
      role="img"
      aria-label={`Preferred playing positions: ${
        [primary, ...secondary]
          .filter(Boolean)
          .map((p) => POSITION_LABELS[p as Position])
          .join(', ') || 'Not provided'
      }`}
    >
      <span className="pitch-circle" />
      {Object.entries(coordinates)
        .filter(([code]) => code === primary || secondary.includes(code as Position))
        .map(([code, [x, y]]) => (
          <span
            key={code}
            className={`pitch-position ${code === primary ? 'primary' : ''}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            {code}
          </span>
        ))}
    </div>
  );
}
export function PlayerProfilePage({ id }: { id?: string }) {
  const own = !id;
  const endpoint = own ? '/me/player-profile' : `/management/players/${id}/profile`;
  const resource = useResource<PlayerProfileResponse>(endpoint);
  const data = resource.data;
  const initialized = useRef('');
  const [fields, setFields] = useState<FootballFields>({
    preferredFoot: null,
    primaryPosition: null,
    secondaryPositions: [],
  });
  const [shirt, setShirt] = useState('');
  const [assigned, setAssigned] = useState<Position | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!data || initialized.current === data.membershipId) return;
    initialized.current = data.membershipId;
    setFields({
      preferredFoot: data.profile.preferredFoot,
      primaryPosition: data.profile.primaryPosition,
      secondaryPositions: data.profile.secondaryPositions,
    });
    setShirt(data.profile.shirtNumber?.toString() ?? '');
    setAssigned(data.profile.assignedPosition ?? '');
  }, [data]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (own) {
        const result = footballFields.safeParse(fields);
        if (!result.success)
          throw new Error(result.error.issues[0]?.message ?? 'Check your positions.');
        await api(endpoint, { method: 'PATCH', body: result.data });
      } else
        await api(endpoint, {
          method: 'PATCH',
          body: {
            shirtNumber: shirt === '' ? null : Number(shirt),
            assignedPosition: assigned || null,
          },
        });
      setMessage(own ? 'Your football profile has been saved.' : 'Team details saved.');
      await resource.reload();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function savePhoto(remove = false) {
    if (busy || (!remove && !file)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (remove) await api('/me/player-profile/photo', { method: 'DELETE', body: {} });
      else {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]!);
          reader.onerror = () => reject(new Error('The photo could not be read. Choose it again.'));
          reader.readAsDataURL(file!);
        });
        await api('/me/player-profile/photo', {
          method: 'PUT',
          body: { content, mimeType: file!.type },
        });
      }
      setFile(null);
      setPickerKey((value) => value + 1);
      await resource.reload();
      setMessage(remove ? 'Profile photo removed.' : 'Profile photo updated.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (resource.loading) return <Loading />;
  if (!data)
    return (
      <>
        <Feedback error={resource.error} />
        <Button onClick={resource.reload}>Retry loading profile</Button>
        <Link href={own ? '/home' : '/management/players'}>Back to {own ? 'home' : 'players'}</Link>
      </>
    );
  const p = own ? fields : data.profile;
  const missing = [
    !data.profile.photoVersion && 'photo',
    !fields.preferredFoot && 'preferred foot',
    !fields.primaryPosition && 'primary position',
  ].filter(Boolean);
  return (
    <>
      <PageTitle
        eyebrow={own ? 'YOUR FOOTBALL PROFILE' : 'MANAGEMENT / PLAYER PROFILE'}
        title={own ? 'Your game. Your profile.' : data.name}
      >
        {own
          ? 'Your photo and football preferences follow you across your teams.'
          : `Player profile · ${data.teamName}`}
      </PageTitle>
      <Link className="text-action" href={own ? '/account' : '/management/players'}>
        Back to {own ? 'account' : 'players'}
      </Link>
      <Feedback error={error ?? resource.error} success={message} />
      {own && missing.length > 0 && (
        <p className="notice">
          Complete your profile: add {missing.join(', ')}. You can keep using the app while you do.
        </p>
      )}
      <div className="split-grid profile-layout">
        <article className="panel profile-card" aria-label={`${data.name} player card`}>
          <div className="profile-card-head">
            <PlayerAvatar
              id={data.membershipId}
              name={data.name}
              version={data.profile.photoVersion}
              preview={preview}
            />
            <div>
              <p className="eyebrow">{data.teamName}</p>
              <h2>{data.name}</h2>
              <Status
                value={!data.isVerified ? 'UNVERIFIED' : data.active ? 'ACTIVE' : 'INACTIVE'}
              />
            </div>
            <strong className="shirt-number">
              {data.profile.shirtNumber !== null ? `#${data.profile.shirtNumber}` : '—'}
            </strong>
          </div>
          <dl className="profile-facts">
            <div>
              <dt>Preferred foot</dt>
              <dd>
                {p.preferredFoot
                  ? { LEFT: 'Left', RIGHT: 'Right', BOTH: 'Both' }[p.preferredFoot]
                  : 'Not provided'}
              </dd>
            </div>
            <div>
              <dt>Primary position</dt>
              <dd>{p.primaryPosition ? POSITION_LABELS[p.primaryPosition] : 'Not provided'}</dd>
            </div>
            <div>
              <dt>Secondary positions</dt>
              <dd>
                {p.secondaryPositions.map((pos) => POSITION_LABELS[pos]).join(', ') ||
                  'Not provided'}
              </dd>
            </div>
            <div>
              <dt>Assigned team position</dt>
              <dd>
                {data.profile.assignedPosition
                  ? POSITION_LABELS[data.profile.assignedPosition]
                  : 'Not provided'}
              </dd>
            </div>
          </dl>
          <Pitch primary={p.primaryPosition} secondary={p.secondaryPositions} />
          <p className="helper">
            Filled marker: primary position. Outlined markers: secondary positions.
          </p>
          <h3>Attendance with {data.teamName}</h3>
          {data.attendance.total ? (
            <p>
              {data.attendance.attended} attended · {data.attendance.missed} missed ·{' '}
              {data.attendance.percentage}% attendance
            </p>
          ) : (
            <p>No completed sessions yet.</p>
          )}
          <p className="helper">
            Only closed training sessions with {own ? 'you' : 'this player'} on the session roster
            count.
          </p>
        </article>
        <section className="panel">
          <h2>{own ? 'Edit your football profile' : 'Team details'}</h2>
          <form className="form-stack" onSubmit={save}>
            {own ? (
              <>
                <p className="helper">
                  Coaches in each of your teams can see these shared preferences.
                </p>
                <label className="field">
                  Preferred foot
                  <select
                    aria-label="Preferred foot"
                    value={fields.preferredFoot ?? ''}
                    onChange={(e) =>
                      setFields({
                        ...fields,
                        preferredFoot: (e.target.value as FootballFields['preferredFoot']) || null,
                      })
                    }
                  >
                    <option value="">Not provided</option>
                    <option value="LEFT">Left</option>
                    <option value="RIGHT">Right</option>
                    <option value="BOTH">Both</option>
                  </select>
                </label>
                <label className="field">
                  Primary position
                  <select
                    aria-label="Primary position"
                    value={fields.primaryPosition ?? ''}
                    onChange={(e) => {
                      const position = e.target.value as Position;
                      setFields({
                        ...fields,
                        primaryPosition: position || null,
                        secondaryPositions: fields.secondaryPositions.filter((p) => p !== position),
                      });
                    }}
                  >
                    <option value="">Not provided</option>
                    {Object.entries(POSITION_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label} ({code})
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend>Secondary positions (up to two)</legend>
                  <div className="position-options">
                    {Object.entries(POSITION_LABELS).map(([code, label]) => (
                      <label key={code} className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={fields.secondaryPositions.includes(code as Position)}
                          disabled={
                            code === fields.primaryPosition ||
                            (fields.secondaryPositions.length >= 2 &&
                              !fields.secondaryPositions.includes(code as Position))
                          }
                          onChange={(e) =>
                            setFields({
                              ...fields,
                              secondaryPositions: e.target.checked
                                ? [...fields.secondaryPositions, code as Position]
                                : fields.secondaryPositions.filter((p) => p !== code),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            ) : (
              <>
                <p>
                  Football preferences are maintained by the player. These team details apply only
                  to {data.teamName}.
                </p>
                <Field
                  label="Shirt number"
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  value={shirt}
                  onChange={(e) => setShirt(e.target.value)}
                />
                <label className="field">
                  Assigned team position
                  <select
                    aria-label="Assigned team position"
                    value={assigned}
                    onChange={(e) => setAssigned(e.target.value as Position | '')}
                  >
                    <option value="">Not provided</option>
                    {Object.entries(POSITION_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label} ({code})
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <Button type="submit" busy={busy}>
              {own ? 'Save football profile' : 'Save team details'}
            </Button>
          </form>
          {own && (
            <div className="form-stack profile-photo-editor">
              <h3>Profile photo</h3>
              <p className="helper">
                JPEG, PNG or WebP, up to 2 MiB and 20 megapixels. Your photo is cropped to a square
                and stays private to you and your team staff.
              </p>
              <Field
                key={pickerKey}
                label="Choose profile photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (!chosen) return;
                  if (
                    chosen.size > PROFILE_PHOTO_MAX_BYTES ||
                    !['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type)
                  ) {
                    setError('Choose a JPEG, PNG or WebP no larger than 2 MiB.');
                    event.target.value = '';
                    return;
                  }
                  setError(null);
                  setFile(chosen);
                }}
              />
              {file && (
                <>
                  <p>Preview shown on your player card. Save the photo to apply it.</p>
                  <Button busy={busy} onClick={() => savePhoto()}>
                    Save profile photo
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setFile(null);
                      setPickerKey((value) => value + 1);
                    }}
                  >
                    Cancel photo change
                  </Button>
                </>
              )}
              {data.profile.photoVersion && (
                <Button
                  variant="secondary"
                  busy={busy}
                  onClick={() => {
                    if (window.confirm('Remove your profile photo from all your teams?'))
                      void savePhoto(true);
                  }}
                >
                  Remove profile photo
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
