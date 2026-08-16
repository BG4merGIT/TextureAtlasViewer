/* textureatlas.js
   Full-featured JSON TextureAtlas manager.
   - Multiple PNGs + JSONs
   - Drag & drop
   - Search, rename, reorder (drag), preview (zoom), per-sprite download, download-all ZIP
   - Export updated JSON (TexturePacker-style)
   - Ensures downloaded sprites preserve exact pixel dimensions (no squish)
*/

(() => {
  // Elements
  const atlasInput = document.getElementById('atlasJSONInput');
  const jsonInput = document.getElementById('jsonInput');
  const atlasListContainer = document.getElementById('atlasListContainer');
  const spritesContainer = document.getElementById('spritesJSONContainer');
  const previewCanvas = document.getElementById('jsonPreviewCanvas');
  const metaDiv = document.getElementById('jsonMeta');
  const searchInput = document.getElementById('json-search');
  const zoomInput = document.getElementById('json-zoom');
  const prevBtn = document.getElementById('json-prev');
  const nextBtn = document.getElementById('json-next');
  const renameInput = document.getElementById('renameJSONInput');
  const renameBtn = document.getElementById('renameJSONBtn');
  const downloadOneBtn = document.getElementById('json-download-one');
  const downloadAllBtn = document.getElementById('json-download-all');
  const exportMapBtn = document.getElementById('json-export-map');
  const statsEl = document.getElementById('jsonStats');

  // State
  const atlases = new Map(); // key -> { name, image, url, frames: [{name,x,y,w,h,rotated}], jsonSources: [], order:[] }
  let selectedAtlasKey = null;
  let selectedFrameIndex = null; // index in atlas.frames
  let filterQuery = '';

  // Helpers
  const JSZIP = window.JSZip;

  function sanitizeFilename(name) {
    return name.replace(/[\/\\?%*:|"<>]/g, '_').trim() || 'sprite';
  }

  // Drag & drop anywhere: route files to loader
  window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragover'); });
  window.addEventListener('dragleave', e => { document.body.classList.remove('dragover'); });
  window.addEventListener('drop', e => {
    e.preventDefault(); document.body.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files || []);
    routeDroppedFiles(files);
  });

  function routeDroppedFiles(files) {
    const pngs = files.filter(f => f.name.match(/\.png$/i));
    const jsons = files.filter(f => f.name.match(/\.json$/i));
    if (pngs.length) handlePNGs(pngs);
    if (jsons.length) handleJSONs(jsons);
  }

  // File input handlers
  atlasInput.addEventListener('change', e => handlePNGs(Array.from(e.target.files || [])));
  jsonInput.addEventListener('change', e => handleJSONs(Array.from(e.target.files || [])));

  // Load PNGs
  function handlePNGs(files) {
    files.forEach(file => {
      const base = file.name.replace(/\.png$/i, '');
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      img.onload = () => {
        const key = base;
        if (!atlases.has(key)) {
          atlases.set(key, { name: key, image: img, url, frames: [], jsonSources: [], order: [] });
        } else {
          const a = atlases.get(key);
          // replace image
          if (a.url) URL.revokeObjectURL(a.url);
          a.image = img; a.url = url;
        }
        renderAtlasList();
        autoAssignJSONs();
        updateStats();
      };
      img.onerror = () => { URL.revokeObjectURL(url); console.warn('Atlas PNG failed to load:', file.name); };
    });
  }

  // Load JSONs
  function handleJSONs(files) {
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          const parsed = parseJSONMap(obj);
          const jsonBase = file.name.replace(/\.json$/i, '');
          const imageNameBase = parsed.imageName ? parsed.imageName.replace(/\.(png|jpg|jpeg)$/i, '') : null;
          const key = imageNameBase || jsonBase;
          const entry = atlases.get(key) || { name: key, image: null, url: null, frames: [], jsonSources: [], order: [] };
          entry.jsonSources.push({ filename: file.name, raw: obj });
          // merge frames (keep original order appended)
          parsed.frames.forEach(f => entry.frames.push(Object.assign({}, f)));
          if (!atlases.has(key)) atlases.set(key, entry);
          renderAtlasList();
          autoAssignJSONs();
          updateStats();
        } catch (err) {
          console.error('Invalid JSON', file.name, err);
          alert('Invalid JSON: ' + file.name);
        }
      };
      reader.readAsText(file);
    });
  }

  // Parse known JSON variations into { imageName, frames: [ {name,x,y,w,h,rotated} ] }
  function parseJSONMap(obj) {
    // TexturePacker object style
    if (obj.frames && (Array.isArray(obj.frames) || typeof obj.frames === 'object')) {
      const framesOut = [];
      if (Array.isArray(obj.frames)) {
        obj.frames.forEach(entry => {
          const fname = entry.filename || entry.name || 'sprite';
          const f = entry.frame || entry;
          framesOut.push({ name: fname, x: f.x | 0, y: f.y | 0, w: f.w || f.w || f.width || 0, h: f.h || f.h || f.height || 0, rotated: !!entry.rotated });
        });
      } else {
        Object.keys(obj.frames).forEach(k => {
          const entry = obj.frames[k];
          const f = entry.frame || entry;
          framesOut.push({ name: (entry.filename || k), x: f.x | 0, y: f.y | 0, w: f.w || f.width || 0, h: f.h || f.height || 0, rotated: !!entry.rotated });
        });
      }
      return { imageName: obj.meta && obj.meta.image ? obj.meta.image : null, frames: framesOut };
    }

    // Adobe Animate (ATLAS -> SPRITES -> SPRITE)
    if (obj.ATLAS && Array.isArray(obj.ATLAS.SPRITES)) {
      const frames = obj.ATLAS.SPRITES.map(i => {
        const s = i.SPRITE;
        return { name: s.name, x: parseInt(s.x), y: parseInt(s.y), w: parseInt(s.w), h: parseInt(s.h), rotated: !!s.rotated };
      });
      return { imageName: obj.meta && obj.meta.image ? obj.meta.image : null, frames };
    }

    // fallback: frames array
    if (obj.frames && Array.isArray(obj.frames)) {
      const frames = obj.frames.map(f => ({ name: f.filename || f.name || 'sprite', x: f.x|0, y: f.y|0, w: f.w || f.width || 0, h: f.h || f.height || 0, rotated: !!f.rotated }));
      return { imageName: obj.meta && obj.meta.image ? obj.meta.image : null, frames };
    }

    return { imageName: obj.meta && obj.meta.image ? obj.meta.image : null, frames: [] };
  }

  // Try to auto-assign JSONs that referenced image names to PNG-loaded atlases
  function autoAssignJSONs() {
    // find placeholders that have frames but no image; check if any png exists with that name
    for (const [key, entry] of atlases.entries()) {
      if (!entry.image && entry.frames.length) {
        // maybe there exists a PNG with same base name
        const candidate = atlases.get(key);
        if (candidate && candidate.image) {
          // already good
          continue;
        }
      }
    }
    // If there are placeholder entries with name X and there exists an image with same name in map set, move frames over
    for (const [key, entry] of Array.from(atlases.entries())) {
      if (entry.jsonSources && entry.jsonSources.length && !entry.image) {
        // look if there's an image atlas keyed by json meta imageName inside other entries
        // nothing heavy here: just leave as-is; user can manually upload PNG matching name
      }
    }
  }

  // UI rendering
  function renderAtlasList() {
    atlasListContainer.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'atlas-list';
    for (const [key, entry] of atlases.entries()) {
      const card = document.createElement('div');
      card.className = 'atlas-card';
      card.dataset.key = key;

      const thumb = document.createElement('div'); thumb.className = 'thumb';
      if (entry.image) {
        const img = document.createElement('img'); img.src = entry.image.src; thumb.appendChild(img);
      } else {
        thumb.textContent = entry.name;
        thumb.style.color = '#9fb0c3';
      }

      const body = document.createElement('div'); body.className = 'body';
      const title = document.createElement('div'); title.className = 'title'; title.textContent = entry.name;
      const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = (entry.image ? `${entry.image.width}Ã—${entry.image.height}` : 'no image') + ` â€¢ ${entry.frames.length} sprites`;

      body.appendChild(title); body.appendChild(meta);
      card.appendChild(thumb); card.appendChild(body);

      card.addEventListener('click', () => {
        selectedAtlasKey = key;
        selectedFrameIndex = 0;
        renderSprites();
      });

      list.appendChild(card);
    }
    atlasListContainer.appendChild(list);
  }

  function updateStats() {
    let total = 0, imgs = 0;
    for (const e of atlases.values()) {
      total += (e.frames ? e.frames.length : 0);
      if (e.image) imgs++;
    }
    statsEl.textContent = `Atlases: ${atlases.size} â€¢ Images: ${imgs} â€¢ Total sprites: ${total}`;
  }

  // Render sprites grid for selected atlas
  function renderSprites() {
    spritesContainer.innerHTML = '';
    if (!selectedAtlasKey || !atlases.has(selectedAtlasKey)) return;
    const atlas = atlases.get(selectedAtlasKey);
    if (!atlas.frames || atlas.frames.length === 0) {
      spritesContainer.innerHTML = `<div class="empty">No sprites found in "${atlas.name}" â€” load a JSON or PNG that matches</div>`;
      metaDiv.textContent = '';
      return;
    }

    // Build drag-drop reorderable grid
    atlas._visibleFrames = atlas.frames.filter(f => f.name.toLowerCase().includes(filterQuery.toLowerCase()));
    atlas._visibleFrames.forEach((frame, idx) => {
      const item = document.createElement('div');
      item.className = 'sprite-item';
      item.draggable = true;
      item.dataset.index = atlas.frames.indexOf(frame); // full index

      // Thumbnail canvas (scaled only for display)
      const thumb = document.createElement('canvas');
      const maxSide = 96;
      const scale = Math.min(1, maxSide / Math.max(frame.w || 1, frame.h || 1));
      thumb.width = Math.max(1, Math.round(frame.w * scale));
      thumb.height = Math.max(1, Math.round(frame.h * scale));
      // draw onto thumb
      const tctx = thumb.getContext('2d');
      if (atlas.image) {
        if (frame.rotated) {
          // source in atlas is (h,w) region; draw to offscreen then rotate CCW to show upright
          const off = document.createElement('canvas'); off.width = frame.h; off.height = frame.w;
          const offCtx = off.getContext('2d');
          offCtx.drawImage(atlas.image, frame.x, frame.y, frame.h, frame.w, 0, 0, frame.h, frame.w);
          // rotate CCW -90 to upright
          tctx.save();
          tctx.translate(thumb.width / 2, thumb.height / 2);
          tctx.rotate(-Math.PI / 2);
          tctx.drawImage(off, -off.width * scale / 2, -off.height * scale / 2, off.width * scale, off.height * scale);
          tctx.restore();
        } else {
          tctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, 0, 0, thumb.width, thumb.height);
        }
      } else {
        tctx.fillStyle = '#0a0b0c';
        tctx.fillRect(0, 0, thumb.width, thumb.height);
      }

      const nameEl = document.createElement('div'); nameEl.className = 'sname'; nameEl.textContent = frame.name;

      item.appendChild(thumb);
      item.appendChild(nameEl);

      // Click selects
      item.addEventListener('click', () => {
        const fullIndex = Number(item.dataset.index);
        selectSpriteIndex(fullIndex);
      });

      // Drag reorder handlers
      item.addEventListener('dragstart', (ev) => {
        item.classList.add('dragging');
        ev.dataTransfer.setData('text/plain', item.dataset.index);
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('dragover', ev => { ev.preventDefault(); });
      item.addEventListener('drop', ev => {
        ev.preventDefault();
        const fromIndex = Number(ev.dataTransfer.getData('text/plain'));
        const toIndex = Number(item.dataset.index);
        reorderFrames(atlas, fromIndex, toIndex);
        renderSprites();
      });

      spritesContainer.appendChild(item);
    });

    // if selected index not set or out of range, set to first visible
    if (selectedFrameIndex === null || selectedFrameIndex >= atlas.frames.length) {
      selectedFrameIndex = 0;
    }
    renderPreview();
    updateStats();
  }

  // Reorder frames array (from -> to)
  function reorderFrames(atlas, from, to) {
    if (from === to) return;
    const arr = atlas.frames;
    const frame = arr.splice(from, 1)[0];
    arr.splice(to, 0, frame);
    // keep selection on moved item
    selectedFrameIndex = atlas.frames.indexOf(frame);
  }

  // Select frame by full index in atlas.frames
  function selectSpriteIndex(fullIndex) {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    if (!atlas || fullIndex < 0 || fullIndex >= atlas.frames.length) return;
    selectedFrameIndex = fullIndex;
    // highlight selected thumbnail
    const children = Array.from(spritesContainer.children);
    children.forEach(c => c.classList.toggle('selected', Number(c.dataset.index) === selectedFrameIndex));
    renameInput.value = atlas.frames[selectedFrameIndex].name || '';
    renderPreview();
  }

  // Draw large preview (zoom controlled)
  function renderPreview() {
    const ctx = previewCanvas.getContext('2d');
    previewCanvas.width = 640;
    previewCanvas.height = 640;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (!selectedAtlasKey || !atlases.has(selectedAtlasKey)) return;
    const atlas = atlases.get(selectedAtlasKey);
    const frame = atlas.frames[selectedFrameIndex];
    if (!frame) {
      metaDiv.textContent = '';
      return;
    }
    const zoom = parseFloat(zoomInput.value || 2);

    // compute source w/h upright
    let srcW = frame.w, srcH = frame.h;
    if (frame.rotated) { srcW = frame.w; srcH = frame.h; /* output size stays w x h */ }

    const drawW = Math.round(srcW * zoom);
    const drawH = Math.round(srcH * zoom);
    const ox = Math.round((previewCanvas.width - drawW) / 2);
    const oy = Math.round((previewCanvas.height - drawH) / 2);

    if (!atlas.image) {
      ctx.fillStyle = '#0a0b0c'; ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      ctx.fillStyle = '#bfcfe0'; ctx.fillText('No atlas image loaded', 16, 20);
      metaDiv.textContent = `${frame.name} â€” ${frame.w}Ã—${frame.h}${frame.rotated ? ' (rotated stored)' : ''}`;
      return;
    }

    if (frame.rotated) {
      // atlas region is frame.h x frame.w at (x,y); draw that region into an offscreen then rotate CCW -90 to upright at correct scale
      const off = document.createElement('canvas'); off.width = frame.h; off.height = frame.w;
      const offCtx = off.getContext('2d');
      offCtx.drawImage(atlas.image, frame.x, frame.y, frame.h, frame.w, 0, 0, frame.h, frame.w);
      // draw rotated onto preview
      ctx.save();
      ctx.translate(ox + drawW / 2, oy + drawH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(off, -drawH / (2 * zoom) * zoom, -drawW / (2 * zoom) * zoom, off.width * (drawW / off.width), off.height * (drawH / off.height));
      // Because of complexity of direct drawing math, easier path: create temporary scaled canvas and rotate correctly:
      ctx.restore();
      // simpler: draw via another temp scaled canvas
      const scaled = document.createElement('canvas'); scaled.width = drawW; scaled.height = drawH;
      const sctx = scaled.getContext('2d');
      // Rotate off image into upright to scaled
      sctx.save();
      sctx.translate(scaled.width / 2, scaled.height / 2);
      sctx.rotate(-Math.PI / 2);
      sctx.drawImage(off, -off.width * (drawH / off.height) / 2, -off.height * (drawW / off.width) / 2, off.width * (drawH / off.height), off.height * (drawW / off.width));
      sctx.restore();
      ctx.drawImage(scaled, ox, oy);
    } else {
      ctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, ox, oy, drawW, drawH);
    }

    metaDiv.textContent = `${frame.name} â€” ${frame.w}Ã—${frame.h}${frame.rotated ? ' (rotated stored)' : ''}`;
  }

  // Convert a frame to an exact-size canvas (no scaling), unrotated upright
  function frameToCanvas(atlas, frame) {
    const out = document.createElement('canvas');
    out.width = frame.w;
    out.height = frame.h;
    const ctx = out.getContext('2d');

    if (!atlas.image) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, out.width, out.height);
      return out;
    }

    if (!frame.rotated) {
      // straightforward crop
      ctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      return out;
    }

    // Rotated case: stored region is (frame.h x frame.w) at frame.x,frame.y
    // We need to extract that region, rotate it CCW -90deg to get upright (w x h)
    const off = document.createElement('canvas');
    off.width = frame.h;
    off.height = frame.w;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(atlas.image, frame.x, frame.y, frame.h, frame.w, 0, 0, frame.h, frame.w);

    // draw rotated onto out canvas
    ctx.save();
    // move origin to center for rotation
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(-Math.PI / 2); // -90deg to make upright
    // draw off centered; note off width=frame.h, height=frame.w; after rotation it fits into out.width/out.height
    ctx.drawImage(off, -off.width / 2, -off.height / 2, off.width, off.height);
    ctx.restore();
    return out;
  }

  // Downloads
  downloadOneBtn.addEventListener('click', () => {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    const frame = atlas.frames[selectedFrameIndex];
    if (!frame) return;
    const canvas = frameToCanvas(atlas, frame);
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = sanitizeFilename(frame.name) + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  });

  downloadAllBtn.addEventListener('click', async () => {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    const zip = new JSZIP();
    for (let i = 0; i < atlas.frames.length; i++) {
      const f = atlas.frames[i];
      const canvas = frameToCanvas(atlas, f);
      const data = canvas.toDataURL('image/png').split(',')[1];
      zip.file(sanitizeFilename(f.name || (`sprite_${i}`)) + '.png', data, { base64: true });
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeFilename(atlas.name)}_sprites.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Export updated JSON (TexturePacker-style)
  exportMapBtn.addEventListener('click', () => {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    const out = { frames: {}, meta: { image: `${atlas.name}.png`, format: "RGBA8888", size: { w: atlas.image ? atlas.image.width : 0, h: atlas.image ? atlas.image.height : 0 }, scale: "1" } };
    atlas.frames.forEach(f => {
      out.frames[f.name || `sprite_${atlas.frames.indexOf(f)}`] = {
        frame: { x: f.x, y: f.y, w: f.w, h: f.h },
        rotated: !!f.rotated,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
        sourceSize: { w: f.w, h: f.h }
      };
    });
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeFilename(atlas.name)}_updated.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Rename
  renameBtn.addEventListener('click', () => {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    if (!atlas.frames[selectedFrameIndex]) return;
    const newName = (renameInput.value || '').trim();
    if (!newName) return;
    atlas.frames[selectedFrameIndex].name = newName;
    renderSprites();
  });

  // Search & navigation
  searchInput.addEventListener('input', (e) => { filterQuery = e.target.value || ''; renderSprites(); });
  prevBtn.addEventListener('click', () => { navigate(-1); });
  nextBtn.addEventListener('click', () => { navigate(1); });
  zoomInput.addEventListener('input', renderPreview);

  function navigate(delta) {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    let idx = selectedFrameIndex == null ? 0 : selectedFrameIndex;
    idx = Math.max(0, Math.min(atlas.frames.length - 1, idx + delta));
    selectSpriteIndex(idx);
  }

  // Keyboard arrows
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') navigate(-1);
    if (e.key === 'ArrowRight') navigate(1);
  });

  // Theme toggle (basic)
  const themeToggle = document.getElementById('themeToggle');
  themeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('light');
  });

  // Utility: if only one atlas is present, auto-select it
  const observer = new MutationObserver(() => {
    if (!selectedAtlasKey && atlases.size === 1) {
      selectedAtlasKey = atlases.keys().next().value;
      renderSprites();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial placeholder
  updateStats();

  // expose for testing
  window.TextureAtlasManager = { atlases, renderSprites, frameToCanvas };
})();
