/**
 * photos.js — condition photos.
 *
 * The camera is reached through a plain file input with `capture`, which opens
 * the camera app on a phone and a file picker on a desktop. That works in every
 * browser and inside the Android shell, unlike getUserMedia, which needs a
 * permission dance and a live preview nobody asked for.
 *
 * Images are resized and re-encoded here, before upload: a 12 megapixel phone
 * photo of a chair leg is 4 MB of detail nobody needs, and warehouse uploads
 * happen on warehouse wifi.
 */
window.Photos = (function () {

  var MAX_FULL = 1280;   // longest edge of the stored image
  var MAX_THUMB = 240;   // longest edge of the gallery thumbnail
  var QUALITY_FULL = 0.72;
  var QUALITY_THUMB = 0.6;

  function supported() {
    return !!(window.FileReader && document.createElement('canvas').getContext);
  }

  function enabled() {
    return supported() && (!window.STATE || STATE.settings.featurePhotos !== false);
  }

  function maxPerItem() {
    return (window.STATE && STATE.settings && STATE.settings.maxPhotosPerItem) || 5;
  }

  /* ------------------------------------------------------------ capture */

  /** A camera button wired to a hidden file input. */
  function captureButton(label, onFiles, opts) {
    opts = opts || {};
    var input = U.el('input', {
      type: 'file',
      accept: 'image/*',
      capture: opts.gallery ? null : 'environment',
      multiple: opts.multiple ? 'multiple' : null,
      class: 'hidden-file'
    });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (files.length) onFiles(files);
    });

    var btn = U.el('button', {
      class: opts.buttonClass || 'btn btn--sm',
      type: 'button',
      onclick: function () { input.click(); }
    }, [cameraIcon(), label]);

    return U.el('span', { class: 'photo-capture' }, [btn, input]);
  }

  function cameraIcon() {
    var span = U.el('span', { class: 'icon' });
    span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 7h3l2-2h8l2 2h3v12H3z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>';
    return span;
  }

  /* -------------------------------------------------------- compression */

  /**
   * Reads a file, corrects its orientation, and returns a full image and a
   * thumbnail, both as data URLs.
   */
  function prepare(file) {
    if (!/^image\//.test(file.type)) {
      return Promise.reject(new Error('That file is not an image.'));
    }
    return loadBitmap(file).then(function (bitmap) {
      var full = draw(bitmap, MAX_FULL, QUALITY_FULL);
      var thumb = draw(bitmap, MAX_THUMB, QUALITY_THUMB);
      if (bitmap.close) bitmap.close();
      return {
        mimeType: 'image/jpeg',
        data: full,
        thumb: thumb,
        bytes: Math.floor(full.length * 3 / 4),
        name: file.name || 'photo.jpg'
      };
    });
  }

  function loadBitmap(file) {
    // createImageBitmap honours the EXIF rotation a phone camera writes,
    // so a photo taken sideways is stored the right way up.
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return loadViaImage(file); });
    }
    return loadViaImage(file);
  }

  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
      img.src = url;
    });
  }

  function draw(bitmap, maxEdge, quality) {
    var w = bitmap.width || bitmap.naturalWidth;
    var h = bitmap.height || bitmap.naturalHeight;
    var scale = Math.min(1, maxEdge / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';           // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /* ---------------------------------------------------------- buckets */

  var CONDITIONS = [
    { key: 'OK', label: 'OK', qtyField: 'okQty', status: 'OK Return' },
    { key: 'Repair', label: 'Repair', qtyField: 'repairQty', status: 'Repair Needed' },
    { key: 'Damaged', label: 'Damaged', qtyField: 'damagedQty', status: 'Damaged Return' }
  ];

  var UNFILED = 'General';

  /**
   * Which condition tabs to show for a line.
   *
   * Only conditions that actually have units appear: photographing "repair"
   * on a line with no repair units would be filing evidence against nothing.
   * Before anything is classified there is one holding bucket, so a photo can
   * still be taken the moment the carton is open.
   */
  function bucketsFor(state, extraTags) {
    var out = CONDITIONS.filter(function (c) {
      if (Number(state.returnQty) === 1) return state.status === c.status;
      return Number(state[c.qtyField] || 0) > 0;
    }).map(function (c) {
      return { key: c.key, label: c.label };
    });

    if (!out.length) out.push({ key: UNFILED, label: 'Not yet classified' });

    // A photo must never become unreachable because a quantity was edited
    // back to zero after it was taken.
    (extraTags || []).forEach(function (tag) {
      if (!out.some(function (b) { return b.key === tag; })) {
        out.push({ key: tag, label: tag === UNFILED ? 'Not yet classified' : tag });
      }
    });

    return out;
  }

  /** The one condition a line is really about, or null when it is mixed. */
  function soleCondition(state) {
    var live = CONDITIONS.filter(function (c) {
      if (Number(state.returnQty) === 1) return state.status === c.status;
      return Number(state[c.qtyField] || 0) > 0;
    });
    return live.length === 1 ? live[0].key : null;
  }

  function tabStrip(buckets, activeKey, countFor, onPick) {
    var strip = U.el('div', { class: 'photo-tabs', role: 'tablist' });
    buckets.forEach(function (b) {
      var count = countFor(b.key);
      var btn = U.el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': b.key === activeKey ? 'true' : 'false',
        class: 'photo-tab photo-tab--' + b.key.toLowerCase() + (b.key === activeKey ? ' is-active' : '')
      }, [
        b.label,
        U.el('span', { class: 'photo-tab__count', text: String(count) })
      ]);
      btn.addEventListener('click', function () { onPick(b.key); });
      strip.appendChild(btn);
    });
    return strip;
  }

  /* ------------------------------------------------- pending (pre-save) */

  /**
   * Gallery for the entry form, one set of photos per condition. Photos are
   * held in memory until the return is saved, because there is no item to
   * attach them to before that.
   * `state.photos` is the array the form reads at submit time.
   */
  function pendingStrip(host, state, onChange) {
    state.photos = state.photos || [];
    var activeKey = null;

    render();
    // The form calls this whenever quantities change, so the tabs follow.
    return { refresh: render };

    function render() {
      U.clear(host);
      if (!enabled()) return;

      var buckets = bucketsFor(state, state.photos.map(function (p) { return p.conditionTag; }));
      if (!activeKey || !buckets.some(function (b) { return b.key === activeKey; })) {
        activeKey = buckets[0].key;
      }

      var shown = state.photos.filter(function (p) { return p.conditionTag === activeKey; });

      host.appendChild(U.el('div', { class: 'photo-head' }, [
        U.el('span', { class: 'photo-head__label', text: 'Condition photos' }),
        U.el('span', { class: 'photo-head__count muted small', text: shown.length + ' of ' + maxPerItem() })
      ]));

      host.appendChild(tabStrip(buckets, activeKey, countIn, function (key) {
        activeKey = key;
        render();
      }));

      var strip = U.el('div', { class: 'photo-strip' });
      shown.forEach(function (photo) {
        strip.appendChild(thumbTile(photo.thumb, {
          caption: photo.caption,
          onOpen: function () { viewData(photo.data, photo.caption); },
          onRemove: function () {
            state.photos.splice(state.photos.indexOf(photo), 1);
            render();
            if (onChange) onChange();
          }
        }));
      });

      if (shown.length < maxPerItem()) {
        strip.appendChild(captureButton(
          shown.length ? 'Add' : 'Take photo',
          function (files) { add(files, shown.length); },
          { buttonClass: 'photo-add', multiple: true }
        ));
      }
      host.appendChild(strip);

      host.appendChild(U.el('div', {
        class: 'hint',
        text: activeKey === UNFILED
          ? 'Optional. Once you enter the quantities above, these photos are filed under the condition they belong to.'
          : 'Optional. These photos are filed under ' + activeKey + ' and uploaded when you save the return.'
      }));
    }

    function countIn(key) {
      return state.photos.filter(function (p) { return p.conditionTag === key; }).length;
    }

    function add(files, existing) {
      var room = maxPerItem() - existing;
      if (files.length > room) {
        U.toast('Only ' + room + ' more photo' + (room === 1 ? '' : 's') + ' can be added under ' + activeKey + '.', 'warn');
        files = files.slice(0, room);
      }
      var tag = activeKey;
      Promise.all(files.map(function (f) {
        return prepare(f).catch(function (err) { U.toast(err.message, 'error'); return null; });
      })).then(function (results) {
        results.filter(Boolean).forEach(function (photo) {
          photo.conditionTag = tag;
          state.photos.push(photo);
        });
        render();
        if (onChange) onChange();
      });
    }
  }

  /** Uploads everything collected on the form once the return exists. */
  function uploadPending(lines, savedItems) {
    var jobs = [];
    lines.forEach(function (line, index) {
      var target = savedItems[index];
      var photos = (line.state && line.state.photos) || [];
      if (!target || !photos.length) return;

      // Anything photographed before the line was classified is filed now,
      // but only when there is exactly one condition it could belong to.
      var fallback = soleCondition(line.state) || UNFILED;
      photos.forEach(function (photo) {
        var tag = photo.conditionTag && photo.conditionTag !== UNFILED ? photo.conditionTag : fallback;
        jobs.push({ returnItemId: target.returnItemId, photo: photo, tag: tag });
      });
    });
    if (!jobs.length) return Promise.resolve({ uploaded: 0, failed: 0, total: 0 });

    var uploaded = 0, failed = 0;
    // Sequential on purpose: a phone on warehouse wifi does better with one
    // upload at a time than with five competing for the same trickle.
    return jobs.reduce(function (chain, job) {
      return chain.then(function () {
        return API.call('uploadPhoto', {
          returnItemId: job.returnItemId,
          data: job.photo.data,
          thumb: job.photo.thumb,
          mimeType: job.photo.mimeType,
          conditionTag: job.tag,
          caption: job.photo.caption || ''
        }).then(function () { uploaded++; })
          .catch(function () { failed++; });
      });
    }, Promise.resolve()).then(function () {
      return { uploaded: uploaded, failed: failed, total: jobs.length };
    });
  }

  /* ------------------------------------------------- saved (post-save) */

  /** Gallery for an item that already exists, split by condition. */
  function itemStrip(host, item, opts) {
    opts = opts || {};
    U.clear(host);
    if (!enabled()) return;

    var activeKey = null;
    var rows = [];
    var status = U.el('div', { class: 'small muted', text: 'Loading photos…' });
    var body = U.el('div');
    host.appendChild(status);
    host.appendChild(body);

    load();

    function load() {
      API.call('getPhotos', { returnItemId: item.returnItemId }).then(function (d) {
        status.remove();
        rows = d.rows;
        paint();
      }).catch(function (err) {
        status.textContent = 'Photos could not be loaded: ' + err.message;
      });
    }

    function paint() {
      U.clear(body);
      var buckets = bucketsFor(item, rows.map(function (r) { return r.conditionTag; }));
      if (!activeKey || !buckets.some(function (b) { return b.key === activeKey; })) {
        activeKey = buckets[0].key;
      }
      var shown = rows.filter(function (r) { return r.conditionTag === activeKey; });

      body.appendChild(tabStrip(buckets, activeKey, function (key) {
        return rows.filter(function (r) { return r.conditionTag === key; }).length;
      }, function (key) { activeKey = key; paint(); }));

      var strip = U.el('div', { class: 'photo-strip' });
      shown.forEach(function (row) {
        strip.appendChild(thumbTile(row.thumb, {
          caption: row.caption || row.conditionTag,
          missing: row.missing,
          onOpen: function () { viewSaved(row); },
          onRemove: opts.canEdit ? function () { remove(row); } : null
        }));
      });

      if (opts.canEdit && shown.length < maxPerItem()) {
        strip.appendChild(captureButton(shown.length ? 'Add' : 'Add photo', function (files) {
          upload(files, shown.length, activeKey);
        }, { buttonClass: 'photo-add', multiple: true }));
      }

      if (!shown.length && !opts.canEdit) {
        strip.appendChild(U.el('span', { class: 'small muted', text: 'No ' + activeKey + ' photos on this item.' }));
      }
      body.appendChild(strip);
    }

    function upload(files, existing, tag) {
      var room = maxPerItem() - existing;
      if (files.length > room) {
        U.toast('Only ' + room + ' more photo' + (room === 1 ? '' : 's') + ' can be added under ' + tag + '.', 'warn');
        files = files.slice(0, room);
      }
      U.toast('Uploading…');
      files.reduce(function (chain, file) {
        return chain.then(function () {
          return prepare(file).then(function (photo) {
            return API.call('uploadPhoto', {
              returnItemId: item.returnItemId,
              data: photo.data, thumb: photo.thumb, mimeType: photo.mimeType,
              conditionTag: tag, caption: ''
            });
          });
        }).catch(function (err) { U.toast(err.message, 'error'); });
      }, Promise.resolve()).then(function () {
        U.toast('Photo saved under ' + tag);
        load();
      });
    }

    function remove(row) {
      U.confirm({
        title: 'Remove this photo?',
        message: 'It leaves the item and goes to the Drive bin, where it can still be recovered.',
        confirmLabel: 'Remove photo',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        API.call('deletePhoto', { photoId: row.photoId, reason: 'Removed from item view' })
          .then(function () { U.toast('Photo removed'); load(); })
          .catch(function (err) { U.toast(err.message, 'error'); });
      });
    }
  }

  /* -------------------------------------------------------------- tiles */

  function thumbTile(src, opts) {
    opts = opts || {};
    var tile = U.el('div', { class: 'photo-tile' });

    if (opts.missing || !src) {
      tile.appendChild(U.el('div', { class: 'photo-tile__missing small', text: 'File missing' }));
    } else {
      var img = U.el('img', { src: src, alt: opts.caption || 'Condition photo', loading: 'lazy' });
      var open = U.el('button', {
        type: 'button', class: 'photo-tile__open',
        'aria-label': 'View ' + (opts.caption || 'photo')
      }, [img]);
      open.addEventListener('click', opts.onOpen);
      tile.appendChild(open);
    }

    if (opts.onRemove) {
      var del = U.el('button', {
        type: 'button', class: 'photo-tile__remove', 'aria-label': 'Remove photo', text: '✕'
      });
      del.addEventListener('click', opts.onRemove);
      tile.appendChild(del);
    }

    return tile;
  }

  /* ------------------------------------------------------------ viewing */

  function viewData(dataUrl, caption) {
    U.modal({
      title: caption || 'Photo',
      wide: true,
      body: U.el('div', { class: 'photo-view' }, [U.el('img', { src: dataUrl, alt: caption || 'Condition photo' })])
    });
  }

  function viewSaved(row) {
    var body = U.el('div', { class: 'photo-view' });
    body.appendChild(U.el('div', { class: 'skeleton', style: 'height:220px' }));
    var m = U.modal({ title: row.caption || row.conditionTag || 'Photo', wide: true, body: body });

    API.call('getPhoto', { photoId: row.photoId }).then(function (d) {
      U.clear(body);
      body.appendChild(U.el('img', { src: d.data, alt: row.caption || 'Condition photo' }));
      body.appendChild(U.el('div', { class: 'small muted', style: 'margin-top:10px',
        text: 'Taken by ' + d.uploadedBy + ' on ' + String(d.uploadedAt).substring(0, 16) }));
    }).catch(function (err) {
      U.empty(body, 'That photo could not be opened', err.message);
    });
    return m;
  }

  return {
    supported: supported,
    enabled: enabled,
    prepare: prepare,
    captureButton: captureButton,
    pendingStrip: pendingStrip,
    uploadPending: uploadPending,
    itemStrip: itemStrip,
    maxPerItem: maxPerItem
  };
})();
