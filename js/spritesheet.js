/* spritesheet.js
   Full-featured XML SpriteSheet manager.
   - Multiple PNG + XML
   - Drag & drop
   - Parse SubTexture nodes
   - Search, rename, reorder, preview (zoom), per-sprite download, download-all ZIP
   - Export updated XML (TexturePacker-style)
   - Ensures downloaded sprites preserve exact pixel dimensions (no squish)
*/

(() => {
  // Elements
  const atlasInput = document.getElementById('atlasXMLInput');
  const xmlInput = document.getElementById('xmlInput');
  const atlasListContainer = document.getElementById('xmlAtlasListContainer');
  const spritesContainer = document.getElementById('spritesXMLContainer');
  const previewCanvas = document.getElementById('xmlPreviewCanvas');
  const metaDiv = document.getElementById('xmlMeta');
  const searchInput = document.getElementById('xml-search');
  const zoomInput = document.getElementById('xml-zoom');
  const prevBtn = document.getElementById('xml-prev');
  const nextBtn = document.getElementById('xml-next');
  const renameInput = document.getElementById('renameXMLInput');
  const renameBtn = document.getElementById('renameXMLBtn');
  const downloadOneBtn = document.getElementById('xml-download-one');
  const downloadAllBtn = document.getElementById('xml-download-all');
  const exportMapBtn = document.getElementById('xml-export-map');
  const statsEl = document.getElementById('xmlStats');

  const JSZIP = window.JSZip;

  // State
  const atlases = new Map(); // key -> { name, image, url, frames: [{name,x,y,w,h,rotated}], xmlSources: [] }
  let selectedAtlasKey = null;
  let selectedFrameIndex = null;
  let filterQuery = '';

  function sanitizeFilename(name) { return name.replace(/[\/\\?%*:|"<>]/g, '_').trim() || 'sprite'; }

  // DnD
  window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragover'); });
  window.addEventListener('dragleave', e => { document.body.classList.remove('dragover'); });
  window.addEventListener('drop', e => {
    e.preventDefault(); document.body.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files || []);
    routeDroppedFiles(files);
  });

  function routeDroppedFiles(files) {
    const pngs = files.filter(f => f.name.match(/\.png$/i));
    const xmls = files.filter(f => f.name.match(/\.xml$/i));
    if (pngs.length) loadPNGs(pngs);
    if (xmls.length) loadXMLs(xmls);
  }

  atlasInput.addEventListener('change', e => loadPNGs(Array.from(e.target.files || [])));
  xmlInput.addEventListener('change', e => loadXMLs(Array.from(e.target.files || [])));

  function loadPNGs(files) {
    files.forEach(file => {
      const base = file.name.replace(/\.png$/i, '');
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      img.onload = () => {
        if (!atlases.has(base)) atlases.set(base, { name: base, image: img, url, frames: [], xmlSources: [] });
        else {
          const a = atlases.get(base);
          if (a.url) URL.revokeObjectURL(a.url);
          a.image = img; a.url = url;
        }
        renderAtlasList();
        updateStats();
      };
      img.onerror = () => { URL.revokeObjectURL(url); console.warn('PNG load failed', file.name); };
    });
  }

  function loadXMLs(files) {
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parser = new DOMParser();
          const xml = parser.parseFromString(reader.result, 'application/xml');
          const taNode = xml.querySelector('TextureAtlas');
          const imageAttr = taNode ? (taNode.getAttribute('imagePath') || taNode.getAttribute('image') || '') : '';
          const baseKey = imageAttr ? imageAttr.replace(/\.(png|jpg|jpeg)$/i, '') : file.name.replace(/\.xml$/i, '');
          const subtex = Array.from(xml.getElementsByTagName('SubTexture'));
          const frames = subtex.map(st => ({
            name: st.getAttribute('name') || 'sprite',
            x: parseInt(st.getAttribute('x') || 0),
            y: parseInt(st.getAttribute('y') || 0),
            w: parseInt(st.getAttribute('width') || st.getAttribute('w') || 0),
            h: parseInt(st.getAttribute('height') || st.getAttribute('h') || 0),
            rotated: (st.getAttribute('rotated') === 'true')
          }));
          const entry = atlases.get(baseKey) || { name: baseKey, image: null, url: null, frames: [], xmlSources: [] };
          entry.xmlSources.push({ filename: file.name, rawXml: reader.result });
          entry.frames = entry.frames.concat(frames);
          if (!atlases.has(baseKey)) atlases.set(baseKey, entry);
          renderAtlasList();
          updateStats();
        } catch (err) {
          console.error('XML parse error', file.name, err);
          alert('Invalid XML file: ' + file.name);
        }
      };
      reader.readAsText(file);
    });
  }

  // Render atlas list
  function renderAtlasList() {
    atlasListContainer.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'atlas-list';
    for (const [key, entry] of atlases.entries()) {
      const card = document.createElement('div'); card.className = 'atlas-card';
      card.dataset.key = key;
      const thumb = document.createElement('div'); thumb.className = 'thumb';
      if (entry.image) {
        const img = document.createElement('img'); img.src = entry.image.src; thumb.appendChild(img);
      } else {
        thumb.textContent = entry.name; thumb.style.color = '#9fb8ca';
      }
      const body = document.createElement('div'); body.className = 'body';
      const title = document.createElement('div'); title.className = 'title'; title.textContent = entry.name;
      const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = (entry.image ? `${entry.image.width}×${entry.image.height}` : 'no image') + ` • ${entry.frames.length} sprites`;
      body.appendChild(title); body.appendChild(meta);
      card.appendChild(thumb); card.appendChild(body);
      card.addEventListener('click', () => { selectedAtlasKey = key; selectedFrameIndex = 0; renderSprites(); });
      wrap.appendChild(card);
    }
    atlasListContainer.appendChild(wrap);
  }

  function updateStats() {
    let total = 0, imgs = 0;
    for (const e of atlases.values()) { total += (e.frames ? e.frames.length : 0); if (e.image) imgs++; }
    statsEl.textContent = `Atlases: ${atlases.size} • Images: ${imgs} • Total sprites: ${total}`;
  }

  // Render sprites for selected atlas
  function renderSprites() {
    spritesContainer.innerHTML = '';
    if (!selectedAtlasKey || !atlases.has(selectedAtlasKey)) return;
    const atlas = atlases.get(selectedAtlasKey);
    if (!atlas.frames.length) {
      spritesContainer.innerHTML = `<div class="empty">No sprites found in "${atlas.name}"</div>`; metaDiv.textContent = ''; return;
    }

    atlas._visibleFrames = atlas.frames.filter(f => f.name.toLowerCase().includes((filterQuery || '').toLowerCase()));

    atlas._visibleFrames.forEach(frame => {
      const item = document.createElement('div'); item.className = 'sprite-item'; item.draggable = true;
      item.dataset.index = atlas.frames.indexOf(frame);

      const thumb = document.createElement('canvas');
      const maxSide = 96;
      const scale = Math.min(1, maxSide / Math.max(frame.w || 1, frame.h || 1));
      thumb.width = Math.max(1, Math.round(frame.w * scale));
      thumb.height = Math.max(1, Math.round(frame.h * scale));
      const tctx = thumb.getContext('2d');
      if (atlas.image) {
        if (frame.rotated) {
          const off = document.createElement('canvas'); off.width = frame.h; off.height = frame.w;
          const offCtx = off.getContext('2d');
          offCtx.drawImage(atlas.image, frame.x, frame.y, frame.h, frame.w, 0, 0, frame.h, frame.w);
          // draw rotated CCW onto thumb
          tctx.save();
          tctx.translate(thumb.width / 2, thumb.height / 2);
          tctx.rotate(-Math.PI / 2);
          tctx.drawImage(off, -off.width * scale / 2, -off.height * scale / 2, off.width * scale, off.height * scale);
          tctx.restore();
        } else {
          tctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, 0, 0, thumb.width, thumb.height);
        }
      } else {
        tctx.fillStyle = '#051018'; tctx.fillRect(0, 0, thumb.width, thumb.height);
      }

      const nameEl = document.createElement('div'); nameEl.className = 'sname'; nameEl.textContent = frame.name;
      item.appendChild(thumb); item.appendChild(nameEl);

      item.addEventListener('click', () => {
        const fullIndex = Number(item.dataset.index);
        selectSprite(fullIndex);
      });

      // drag reorder
      item.addEventListener('dragstart', (ev) => { item.classList.add('dragging'); ev.dataTransfer.setData('text/plain', item.dataset.index); });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('dragover', ev => ev.preventDefault());
      item.addEventListener('drop', ev => {
        ev.preventDefault();
        const from = Number(ev.dataTransfer.getData('text/plain')); const to = Number(item.dataset.index);
        reorderFrames(atlas, from, to);
        renderSprites();
      });

      spritesContainer.appendChild(item);
    });

    if (selectedFrameIndex === null && atlas.frames.length) selectedFrameIndex = 0;
    renderPreview();
    updateStats();
  }

  function reorderFrames(atlas, from, to) {
    if (from === to) return;
    const arr = atlas.frames;
    const f = arr.splice(from, 1)[0];
    arr.splice(to, 0, f);
    selectedFrameIndex = arr.indexOf(f);
  }

  function selectSprite(fullIndex) {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    if (!atlas || fullIndex < 0 || fullIndex >= atlas.frames.length) return;
    selectedFrameIndex = fullIndex;
    document.querySelectorAll('#spritesXMLContainer .sprite-item').forEach(c => c.classList.toggle('selected', Number(c.dataset.index) === selectedFrameIndex));
    renameInput.value = atlas.frames[selectedFrameIndex].name || '';
    renderPreview();
  }

  // render preview canvas
  function renderPreview() {
    const ctx = previewCanvas.getContext('2d');
    previewCanvas.width = 640; previewCanvas.height = 640;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    const frame = atlas.frames[selectedFrameIndex];
    if (!frame) { metaDiv.textContent = ''; return; }
    const zoom = parseFloat(zoomInput.value || 2);
    const drawW = Math.round(frame.w * zoom), drawH = Math.round(frame.h * zoom);
    const ox = Math.round((previewCanvas.width - drawW) / 2), oy = Math.round((previewCanvas.height - drawH) / 2);

    if (!atlas.image) {
      ctx.fillStyle = '#041018'; ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      metaDiv.textContent = `${frame.name} — ${frame.w}×${frame.h}${frame.rotated ? ' (rotated)' : ''}`;
      return;
    }

    if (frame.rotated) {
      // extract rotated source region (h x w), rotate CCW -90 to upright
      const off = document.createElement('canvas'); off.width = frame.h; off.height = frame.w;
      const offCtx = off.getContext('2d');
      offCtx.drawImage(atlas.image, frame.x, frame.y, frame.h, frame.w, 0, 0, frame.h, frame.w);
      // draw scaled rotated onto preview
      const scaled = document.createElement('canvas'); scaled.width = drawW; scaled.height = drawH;
      const sctx = scaled.getContext('2d');
      sctx.save();
      sctx.translate(scaled.width / 2, scaled.height / 2);
      sctx.rotate(-Math.PI / 2);
      sctx.drawImage(off, -off.width / 2, -off.height / 2, off.width, off.height, 0, 0, off.width, off.height);
      sctx.restore();
      ctx.drawImage(scaled, ox, oy);
    } else {
      ctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, ox, oy, drawW, drawH);
    }

    metaDiv.textContent = `${frame.name} — ${frame.w}×${frame.h}${frame.rotated ? ' (rotated)' : ''}`;
  }

  // exact extraction canvas (upright)
  function frameToCanvas(atlas, frame) {
    const out = document.createElement('canvas');
    out.width = frame.w; out.height = frame.h;
    const ctx = out.getContext('2d');

    if (!atlas.image) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, out.width, out.height); return out; }

    if (!frame.rotated) {
      ctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      return out;
    }

    // rotated: stored region is (h x w); draw that into off then rotate CCW -90 into out
    const off = document.createElement('canvas'); off.width = frame.h; off.height = frame.w;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(atlas.image, frame.x, frame.y, frame.h, frame.w, 0, 0, frame.h, frame.w);

    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(off, -off.width / 2, -off.height / 2, off.width, off.height);
    ctx.restore();
    return out;
  }

  // downloads
  downloadOneBtn.addEventListener('click', () => {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    const frame = atlas.frames[selectedFrameIndex];
    if (!frame) return;
    const canvas = frameToCanvas(atlas, frame);
    canvas.toBlob(blob => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = sanitizeFilename(frame.name) + '.png'; a.click(); URL.revokeObjectURL(a.href);
    }, 'image/png');
  });

  downloadAllBtn.addEventListener('click', async () => {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    const zip = new JSZIP();
    for (let i = 0; i < atlas.frames.length; i++) {
      const f = atlas.frames[i];
      const c = frameToCanvas(atlas, f);
      const data = c.toDataURL('image/png').split(',')[1];
      zip.file(sanitizeFilename(f.name || `sprite_${i}`) + '.png', data, { base64: true });
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeFilename(atlas.name)}_sprites.zip`; a.click(); URL.revokeObjectURL(a.href);
  });

  // Export updated XML (TexturePacker SubTexture style)
  exportMapBtn.addEventListener('click', () => {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    const xmlDoc = document.implementation.createDocument('', '', null);
    const root = xmlDoc.createElement('TextureAtlas');
    root.setAttribute('imagePath', `${atlas.name}.png`);
    if (atlas.image) root.setAttribute('width', atlas.image.width), root.setAttribute('height', atlas.image.height);
    atlas.frames.forEach(f => {
      const st = xmlDoc.createElement('SubTexture');
      st.setAttribute('name', f.name);
      st.setAttribute('x', f.x);
      st.setAttribute('y', f.y);
      st.setAttribute('width', f.w);
      st.setAttribute('height', f.h);
      if (f.rotated) st.setAttribute('rotated', 'true');
      root.appendChild(st);
    });
    xmlDoc.appendChild(root);
    const serializer = new XMLSerializer();
    const xmlStr = serializer.serializeToString(xmlDoc);
    const blob = new Blob([xmlStr], { type: 'application/xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeFilename(atlas.name)}_updated.xml`;
    a.click(); URL.revokeObjectURL(a.href);
  });

  // rename
  renameBtn.addEventListener('click', () => {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    if (!atlas.frames[selectedFrameIndex]) return;
    const newName = (renameInput.value || '').trim();
    if (!newName) return;
    atlas.frames[selectedFrameIndex].name = newName;
    renderSprites();
  });

  // search & nav
  searchInput.addEventListener('input', (e) => { filterQuery = e.target.value || ''; renderSprites(); });
  prevBtn.addEventListener('click', () => navigate(-1));
  nextBtn.addEventListener('click', () => navigate(1));
  zoomInput.addEventListener('input', renderPreview);

  function navigate(delta) {
    if (!selectedAtlasKey) return;
    const atlas = atlases.get(selectedAtlasKey);
    let idx = selectedFrameIndex == null ? 0 : selectedFrameIndex;
    idx = Math.max(0, Math.min(atlas.frames.length - 1, idx + delta));
    selectSprite(idx);
  }

  // utility auto-select single atlas
  const observer = new MutationObserver(() => {
    if (!selectedAtlasKey && atlases.size === 1) {
      selectedAtlasKey = atlases.keys().next().value; renderSprites();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  updateStats();

  // expose for debug
  window.SpriteSheetXmlManager = { atlases, frameToCanvas };
})();
