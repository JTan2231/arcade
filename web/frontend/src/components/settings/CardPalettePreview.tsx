import { useMemo, type CSSProperties } from "react";

import { arcadeDarkProfile, compileCardPalettePair, type CompiledCardPalette, type ThemeProfile } from "../../palette";
import type { PostCardPaletteMaterialIntent, PostContentTypeface } from "../../types";

export function CardPalettePreviewPair({
  materialIntent,
  typeface = "monospace",
}: {
  materialIntent: PostCardPaletteMaterialIntent;
  typeface?: PostContentTypeface;
}) {
  const pair = useMemo(() => compileCardPalettePair(materialIntent), [materialIntent]);
  return (
    <div className="card-palette-preview-pair">
      <CardPalettePreview
        compiled={pair.dark}
        profile={arcadeDarkProfile}
        typeface={typeface}
        valid={pair.dark.validation.valid && pair.light.validation.valid}
      />
    </div>
  );
}

export function CardPaletteThumbnail({ materialIntent }: { materialIntent: PostCardPaletteMaterialIntent }) {
  const pair = useMemo(() => compileCardPalettePair(materialIntent), [materialIntent]);
  return (
    <span aria-hidden="true" className="card-palette-thumbnail">
      <span style={{ background: pair.dark.tokens["--post-card-surface"] }} />
    </span>
  );
}

function CardPalettePreview({
  compiled,
  profile,
  typeface,
  valid,
}: {
  compiled: CompiledCardPalette;
  profile: ThemeProfile;
  typeface: PostContentTypeface;
  valid: boolean;
}) {
  const style = {
    ...compiled.tokens,
    background: profile.palette.tokens["--color-page"],
    color: profile.palette.tokens["--color-text-muted"],
  } as CSSProperties;

  return (
    <section className="card-palette-preview" style={style}>
      <div className="card-palette-preview-spotlight">
        <div className="card-palette-preview-byline">
          <span className="card-palette-preview-author">Author name</span>
          <span className="card-palette-preview-time">Today · 3:33 PM</span>
        </div>
        <div className={`card-palette-preview-card post-content-typeface-${typeface}`}>
          <div className="card-palette-preview-card-controls" aria-hidden="true">
            <span>⌃</span>
            <span>□</span>
          </div>
          <div className="card-palette-preview-content">
            <span className="card-palette-preview-keyword">make</span> a small promise
            <br />
            <span className="card-palette-preview-comment">// then keep it daily</span>
          </div>
        </div>
      </div>
      {!valid ? <div className="card-palette-preview-warning">Needs adjustment</div> : null}
    </section>
  );
}
