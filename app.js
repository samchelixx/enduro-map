/* ============================================
   ENDURO MAP — Astrakhan Region
   with fuel calc + edit mode
   ============================================ */

(function () {
    'use strict';

    // ---- PWA Registration (Top Priority to prevent bricking on JS crash) ----
    if('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(e=>console.log('SW:',e));
    }

    const CENTER = [46.35, 48.05], ZOOM = 10;
    const STORAGE = 'enduro_map_v4', BIKES_STORAGE = 'enduro_bikes';
    const BOUNDS = L.latLngBounds(L.latLng(44.8, 44.5), L.latLng(48.8, 49.5));

    const ICONS = { default:'📍', start:'🏁', finish:'🏆', camp:'⛺', water:'💧', danger:'⚠️', fuel:'⛽', repair:'🔧', viewpoint:'👁️' };
    const LABELS = { default:'Точка', start:'Старт', finish:'Финиш', camp:'Лагерь', water:'Вода', danger:'Опасность', fuel:'Заправка', repair:'Ремонт', viewpoint:'Обзор' };
    const COLORS = ['#f97316','#22c55e','#3b82f6','#a855f7','#ec4899','#14b8a6','#eab308','#ef4444','#06b6d4','#84cc16'];
    const DOT = 3;
    const ROAD_STYLE = { color:'rgba(190,190,190,0.45)', weight:3, opacity:1, lineCap:'round', lineJoin:'round' };

    const API_URL = 'https://enduro-server.onrender.com';
    let currentUser = localStorage.getItem('enduro_user') || null;
    let currentToken = localStorage.getItem('enduro_token') || null;

    const DEFAULT_BIKES = [
        { id:1, name:'Мой мотоцикл', tank:8, consumptionL:8, consumptionKm:150 },
        { id:2, name:'Друг', tank:8, consumptionL:8, consumptionKm:150 }
    ];

    // ---- State ----
    let tool = 'pan', baseLayer = 'satellite', labelsOn = true, roadsOn = true;
    let routeColor = COLORS[0], bikes = loadBikes(), selectedBikeId = (loadBikes())[0]?.id || 1;
    let roads = [], markers = [], routes = [];
    let drawPts = [], drawLine = null, drawDots = [];
    let measPts = [], measLine = null, measDots = [];

    // Edit state
    let editing = null;       // { type:'road'|'route', obj, pts:L.LatLng[], vertexMarkers[], midMarkers[], line, continuing:bool }

    // ---- Bikes ----
    function loadBikes() { try { const r = localStorage.getItem(BIKES_STORAGE); if (r) return JSON.parse(r); } catch(e){} return JSON.parse(JSON.stringify(DEFAULT_BIKES)); }
    function saveBikes() { localStorage.setItem(BIKES_STORAGE, JSON.stringify(bikes)); }
    function getBike(id) { return bikes.find(b => b.id === id) || bikes[0]; }
    function fuelPerKm(b) { return b && b.consumptionKm && b.consumptionL ? b.consumptionL / b.consumptionKm : 0; }
    function calcFuel(dm, b) {
        if (!b) return null;
        const dk = dm/1000, pk = fuelPerKm(b), need = dk*pk, range = b.tank/pk;
        const ok = need <= b.tank, extra = ok ? 0 : need - b.tank;
        return { distKm:dk.toFixed(1), needed:need.toFixed(1), range:range.toFixed(0), enough:ok, extra:extra.toFixed(1), tank:b.tank, name:b.name };
    }

    // ---- Map ----
    const map = L.map('map', {
        center:CENTER, zoom:ZOOM, zoomControl:false,
        maxBounds:BOUNDS.pad(0.1), maxBoundsViscosity:1.0,
        minZoom:8, doubleClickZoom:false
    });
    L.control.zoom({ position:'bottomright' }).addTo(map);

    const satLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { subdomains:'0123', maxZoom:21, maxNativeZoom:20, attribution:'© Google' });
    const terrainLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', { subdomains:'0123', maxZoom:21, maxNativeZoom:16, attribution:'© Google' });
    const labelsLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', { subdomains:'0123', maxZoom:21, maxNativeZoom:20, attribution:'', pane:'overlayPane' });

    satLayer.addTo(map); labelsLayer.addTo(map);
    const bases = { satellite:satLayer, terrain:terrainLayer };
    const roadsGroup = L.layerGroup().addTo(map);

    // ---- Layers ----
    const layerBtns = { satellite:$('btn-satellite'), terrain:$('btn-terrain') };
    function setBase(n) {
        map.removeLayer(bases[baseLayer]); bases[n].addTo(map); bases[n].bringToBack();
        Object.values(layerBtns).forEach(b => b.classList.remove('active'));
        layerBtns[n].classList.add('active'); baseLayer = n;
    }
    layerBtns.satellite.addEventListener('click', () => setBase('satellite'));
    layerBtns.terrain.addEventListener('click', () => setBase('terrain'));

    const btnLabels = $('btn-labels');
    btnLabels.addEventListener('click', () => { labelsOn=!labelsOn; labelsOn?labelsLayer.addTo(map):map.removeLayer(labelsLayer); btnLabels.classList.toggle('active',labelsOn); });
    const btnRoads = $('btn-show-roads');
    btnRoads.addEventListener('click', () => { roadsOn=!roadsOn; roadsOn?roadsGroup.addTo(map):map.removeLayer(roadsGroup); btnRoads.classList.toggle('active',roadsOn); });

    // ---- Coords ----
    map.on('mousemove', e => { $('lat-display').textContent=e.latlng.lat.toFixed(5); $('lng-display').textContent=e.latlng.lng.toFixed(5); });
    map.on('zoomend', () => { $('zoom-value').textContent=map.getZoom(); });

    // ---- Color picker ----
    const pickerEl = $('color-picker'), optsEl = $('color-options');
    COLORS.forEach(c => {
        const s = document.createElement('div');
        s.className = 'color-swatch'+(c===routeColor?' active':'');
        s.style.background = c;
        s.addEventListener('click', () => { routeColor=c; optsEl.querySelectorAll('.color-swatch').forEach(x=>x.classList.remove('active')); s.classList.add('active'); });
        optsEl.appendChild(s);
    });

    // ---- Tools ----
    const tBtns = { pan:$('btn-pan'), road:$('btn-road'), route:$('btn-route'), marker:$('btn-marker'), measure:$('btn-measure') };

    function setTool(t) {
        if (editing) { if (t !== 'pan') finishEdit(); else return; }
        if (tool==='road' && t!=='road') finishRoad();
        if (tool==='route' && t!=='route') finishRoute();
        if (tool==='measure' && t!=='measure') finishMeasure();
        tool = t;
        Object.values(tBtns).forEach(b => b.classList.remove('active'));
        tBtns[t].classList.add('active');
        $('map').classList.toggle('cursor-crosshair', t!=='pan');
        pickerEl.classList.toggle('hidden', t!=='route');
        $('info-footer').classList.add('hidden');
        $('info-fuel').classList.add('hidden');
        const h = { road:'Дорога: клик=точка, 2×клик=готово', route:'Маршрут: клик=точка, 2×клик=готово', marker:'Нажмите на карту', measure:'Измерение: клик=точка' };
        if (h[t]) toast(h[t],'info');
    }

    Object.entries(tBtns).forEach(([k,b]) => b.addEventListener('click', () => setTool(k)));

    // ---- Map events ----
    map.on('click', e => {
        if (editing && editing.continuing) { editAddPoint(e.latlng); return; }
        if (editing) return; // in edit drag mode, ignore clicks
        if (tool==='road'||tool==='route') addDrawPt(e.latlng);
        else if (tool==='marker') addMarker(e.latlng);
        else if (tool==='measure') addMeasPt(e.latlng);
    });
    map.on('dblclick', e => {
        if (editing && editing.continuing) { L.DomEvent.stop(e); finishEdit(); return; }
        if (tool==='road') { L.DomEvent.stop(e); finishRoad(); }
        else if (tool==='route') { L.DomEvent.stop(e); finishRoute(); }
        else if (tool==='measure') { L.DomEvent.stop(e); finishMeasure(); }
    });

    $('info-close').addEventListener('click', () => {
        if (editing) finishEdit();
        else $('info-panel').classList.add('hidden');
    });

    // ---- Drawing (new road/route) ----
    function addDrawPt(ll) {
        drawPts.push(ll);
        const isRoad = tool==='road';
        const col = isRoad?'rgba(255,255,255,0.35)':routeColor;
        drawDots.push(L.circleMarker(ll,{ radius:DOT, color:col, fillColor:col, fillOpacity:0.9, weight:1 }).addTo(map));
        if (drawLine) map.removeLayer(drawLine);
        if (drawPts.length>=2) {
            drawLine = L.polyline(drawPts, { color:isRoad?ROAD_STYLE.color:routeColor, weight:3, opacity:isRoad?0.5:0.85, lineCap:'round', lineJoin:'round', dashArray:isRoad?'5,4':null }).addTo(map);
        }
        showDrawInfo(isRoad?'Дорога':'Маршрут', drawPts);
    }

    function undoDraw() {
        if (!drawPts.length) return;
        drawPts.pop(); if (drawDots.length) map.removeLayer(drawDots.pop());
        if (drawLine) { map.removeLayer(drawLine); drawLine=null; }
        if (drawPts.length>=2) { const isR=tool==='road'; drawLine=L.polyline(drawPts,{color:isR?ROAD_STYLE.color:routeColor,weight:3,opacity:isR?0.5:0.85,lineCap:'round',lineJoin:'round',dashArray:isR?'5,4':null}).addTo(map); }
        if (drawPts.length) showDrawInfo(tool==='road'?'Дорога':'Маршрут',drawPts);
        else $('info-panel').classList.add('hidden');
    }

    function clearDraw() {
        drawDots.forEach(d=>map.removeLayer(d)); drawDots=[];
        if (drawLine) map.removeLayer(drawLine); drawLine=null;
        drawPts=[]; $('info-panel').classList.add('hidden');
    }

    function showDrawInfo(title, pts) {
        const d=calcDist(pts);
        $('info-title').textContent=title; $('info-distance').textContent=fmtDist(d); $('info-points').textContent=pts.length;
        $('info-panel').classList.remove('hidden');
        setFooter('draw');
        if (tool==='route') showFuelPanel(d); else $('info-fuel').classList.add('hidden');
    }

    // ---- Dynamic footer ----
    function setFooter(mode) {
        const footer = $('info-footer');
        footer.classList.remove('hidden');
        footer.innerHTML = '';

        if (mode === 'draw') {
            footer.innerHTML = '<button class="info-btn" id="ft-undo">↩ Отмена</button><button class="info-btn primary" id="ft-finish">✓ Готово</button>';
            $('ft-undo').addEventListener('click', undoDraw);
            $('ft-finish').addEventListener('click', () => {
                if (tool==='road') finishRoad();
                else if (tool==='route') finishRoute();
                else if (tool==='measure') finishMeasure();
            });
        } else if (mode === 'edit') {
            footer.innerHTML = '<button class="info-btn edit" id="ft-continue">➕ Продолжить</button><button class="info-btn" id="ft-del-pt">🗑 Точку</button><button class="info-btn primary" id="ft-done">✓ Готово</button>';
            $('ft-continue').addEventListener('click', startContinue);
            $('ft-del-pt').addEventListener('click', () => toast('Нажмите правой кнопкой (или долго) на точку для удаления','info'));
            $('ft-done').addEventListener('click', finishEdit);
        } else if (mode === 'continue') {
            footer.innerHTML = '<button class="info-btn" id="ft-undo-c">↩ Отмена</button><button class="info-btn primary" id="ft-done-c">✓ Завершить</button>';
            $('ft-undo-c').addEventListener('click', editUndoContinue);
            $('ft-done-c').addEventListener('click', finishEdit);
        }
    }

    // ---- Fuel panel ----
    function showFuelPanel(dist) {
        const fEl=$('info-fuel'), selEl=$('info-fuel-bike'), stEl=$('info-fuel-stats');
        fEl.classList.remove('hidden');
        selEl.innerHTML='';
        bikes.forEach(b => { const o=document.createElement('option'); o.value=b.id; o.textContent=`${b.name} (${b.tank}л)`; if(b.id===selectedBikeId)o.selected=true; selEl.appendChild(o); });
        selEl.onchange=()=>{ selectedBikeId=parseInt(selEl.value); renderFuel(dist); };
        renderFuel(dist);
    }
    function renderFuel(dist) {
        const st=$('info-fuel-stats'), b=getBike(selectedBikeId), f=calcFuel(dist,b);
        if(!f){st.innerHTML='<span style="font-size:11px;color:#64748b">—</span>';return;}
        const sc=f.enough?'ok':(parseFloat(f.extra)<=f.tank?'warn':'bad');
        st.innerHTML=`<div class="fuel-chip"><span class="fuel-icon">⛽</span><span class="fuel-val">${f.needed} л</span></div>
            <div class="fuel-chip ${sc}"><span class="fuel-icon">${f.enough?'✅':'⚠️'}</span><span class="fuel-val">${f.enough?'Хватит ✓':'Не хватит'}</span></div>
            ${!f.enough?`<div class="fuel-chip bad"><span class="fuel-icon">🪫</span><span class="fuel-val">+${f.extra} л с собой</span></div>`:''}
            <div class="fuel-chip"><span class="fuel-icon">📏</span><span class="fuel-val">Запас: ${f.range} км</span></div>`;
    }

    // ===========================
    //  EDIT MODE
    // ===========================
    function startEdit(type, obj) {
        // Cancel any drawing
        if (tool==='road') finishRoad();
        if (tool==='route') finishRoute();
        if (tool==='measure') finishMeasure();
        if (editing) finishEdit();

        setTool('pan');
        $('map').classList.remove('cursor-crosshair');

        // Hide existing line/dots
        if (type === 'road') {
            roadsGroup.removeLayer(obj.line);
            roadsGroup.removeLayer(obj.hit);
        } else {
            map.removeLayer(obj.line);
            map.removeLayer(obj.hit);
            if (obj.dots) obj.dots.forEach(d => map.removeLayer(d));
        }

        const pts = obj.data.points.map(p => L.latLng(p[0], p[1]));

        editing = {
            type,
            obj,
            pts,
            vertexMarkers: [],
            midMarkers: [],
            line: null,
            continuing: false
        };

        rebuildEditLine();
        rebuildEditVertices();
        updateEditInfo();

        toast('Режим редактирования — перетаскивайте точки','info');
    }

    function rebuildEditLine() {
        if (editing.line) map.removeLayer(editing.line);
        if (editing.pts.length >= 2) {
            const isRoad = editing.type === 'road';
            editing.line = L.polyline(editing.pts, {
                color: isRoad ? ROAD_STYLE.color : (editing.obj.data.color || routeColor),
                weight: isRoad ? 3 : 3,
                opacity: isRoad ? 0.5 : 0.85,
                lineCap: 'round', lineJoin: 'round',
                dashArray: isRoad ? '5,4' : null
            }).addTo(map);
        }
    }

    function rebuildEditVertices() {
        // Clear old
        editing.vertexMarkers.forEach(m => map.removeLayer(m));
        editing.midMarkers.forEach(m => map.removeLayer(m));
        editing.vertexMarkers = [];
        editing.midMarkers = [];

        // Main vertices — draggable
        editing.pts.forEach((pt, i) => {
            const icon = L.divIcon({ html:'<div class="edit-vertex"></div>', className:'', iconSize:[14,14], iconAnchor:[7,7] });
            const m = L.marker(pt, { icon, draggable:true, zIndexOffset:1000 }).addTo(map);

            m.on('drag', () => {
                editing.pts[i] = m.getLatLng();
                rebuildEditLine();
                updateEditInfo();
            });

            m.on('dragend', () => {
                rebuildMidpoints();
                updateEditInfo();
            });

            // Right-click = delete vertex
            m.on('contextmenu', (e) => {
                L.DomEvent.stop(e);
                if (editing.pts.length <= 2) { toast('Минимум 2 точки','error'); return; }
                editing.pts.splice(i, 1);
                rebuildEditLine();
                rebuildEditVertices();
                updateEditInfo();
            });

            editing.vertexMarkers.push(m);
        });

        // Midpoints — click to insert
        rebuildMidpoints();
    }

    function rebuildMidpoints() {
        editing.midMarkers.forEach(m => map.removeLayer(m));
        editing.midMarkers = [];

        for (let i = 0; i < editing.pts.length - 1; i++) {
            const a = editing.pts[i], b = editing.pts[i + 1];
            const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
            const icon = L.divIcon({ html:'<div class="edit-vertex-mid"></div>', className:'', iconSize:[10,10], iconAnchor:[5,5] });
            const m = L.marker(mid, { icon, zIndexOffset:500 }).addTo(map);

            const idx = i;
            m.on('click', () => {
                // Insert new vertex
                editing.pts.splice(idx + 1, 0, mid);
                rebuildEditLine();
                rebuildEditVertices();
                updateEditInfo();
            });

            editing.midMarkers.push(m);
        }
    }

    function updateEditInfo() {
        const d = calcDist(editing.pts);
        $('info-title').textContent = (editing.type === 'road' ? '✏️ Дорога' : '✏️ Маршрут');
        $('info-distance').textContent = fmtDist(d);
        $('info-points').textContent = editing.pts.length;
        $('info-panel').classList.remove('hidden');

        if (editing.continuing) {
            setFooter('continue');
        } else {
            setFooter('edit');
        }

        if (editing.type === 'route') showFuelPanel(d);
        else $('info-fuel').classList.add('hidden');
    }

    function startContinue() {
        if (!editing) return;
        editing.continuing = true;
        $('map').classList.add('cursor-crosshair');
        toast('Кликайте для добавления точек. 2×клик = завершить.','info');
        updateEditInfo();
    }

    function editAddPoint(ll) {
        if (!editing || !editing.continuing) return;
        editing.pts.push(ll);
        rebuildEditLine();
        rebuildEditVertices();
        updateEditInfo();
    }

    function editUndoContinue() {
        if (!editing || editing.pts.length <= 2) return;
        editing.pts.pop();
        rebuildEditLine();
        rebuildEditVertices();
        updateEditInfo();
    }

    function finishEdit() {
        if (!editing) return;

        const { type, obj, pts } = editing;

        // Update data
        obj.data.points = pts.map(p => [p.lat, p.lng]);
        if (type === 'route') {
            obj.data.distance = calcDist(pts);
        }

        // Cleanup edit visuals
        editing.vertexMarkers.forEach(m => map.removeLayer(m));
        editing.midMarkers.forEach(m => map.removeLayer(m));
        if (editing.line) map.removeLayer(editing.line);

        // Recreate permanent visuals
        if (type === 'road') {
            obj.line = mkRoadLine(obj.data.points);
            obj.hit = mkHitLine(obj.data.points);
            attachRoadEvents(obj);
        } else {
            const lls = pts;
            obj.line = L.polyline(lls, {
                color:obj.data.color, weight:3, opacity:0.9, lineCap:'round', lineJoin:'round'
            }).addTo(map);
            obj.dots = lls.map(p =>
                L.circleMarker(p,{radius:DOT, color:obj.data.color, fillColor:'#fff', fillOpacity:1, weight:1.5}).addTo(map)
            );
            obj.hit = L.polyline(lls, {color:'transparent', weight:16, opacity:0}).addTo(map);
            attachRouteEvents(obj);
        }

        $('map').classList.remove('cursor-crosshair');
        editing = null;
        $('info-panel').classList.add('hidden');
        toast('Изменения сохранены','success');
    }

    // ---- Roads ----
    function finishRoad() {
        if (drawPts.length >= 2) {
            const rd = { id:Date.now(), points:drawPts.map(p=>[p.lat,p.lng]) };
            const line = mkRoadLine(rd.points), hit = mkHitLine(rd.points);
            const obj = { data:rd, line, hit };
            attachRoadEvents(obj);
            roads.push(obj);
            toast(`Дорога: ${fmtDist(calcDist(drawPts))}`,'success');
        }
        clearDraw();
    }

    function attachRoadEvents(obj) {
        function del() {
            if (confirm('Удалить дорогу?')) {
                roadsGroup.removeLayer(obj.line); roadsGroup.removeLayer(obj.hit);
                roads = roads.filter(r => r.data.id !== obj.data.id);
                toast('Дорога удалена','info');
            }
        }
        // Popup with edit / delete
        function mkRoadPopup() {
            const div = document.createElement('div');
            div.className = 'marker-form';
            div.innerHTML = `
                <div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">📏 ${fmtDist(calcDist(obj.data.points.map(p=>L.latLng(p[0],p[1]))))} · ${obj.data.points.length} точек</div>
                <div class="marker-form-buttons">
                    <button class="marker-btn-save">✏️ Редактировать</button>
                    <button class="marker-btn-save" style="background:#14b8a6">➕ Продолжить</button>
                    <button class="marker-btn-delete">Удалить</button>
                </div>`;
            const btns = div.querySelectorAll('.marker-btn-save');
            btns[0].addEventListener('click', () => { map.closePopup(); startEdit('road', obj); });
            btns[1].addEventListener('click', () => { map.closePopup(); startEdit('road', obj); setTimeout(startContinue, 100); });
            div.querySelector('.marker-btn-delete').addEventListener('click', del);
            return div;
        }
        obj.line.unbindPopup();
        obj.hit.unbindPopup();
        obj.line.bindPopup(mkRoadPopup(), { maxWidth:280 });
        obj.hit.bindPopup(mkRoadPopup(), { maxWidth:280 });
        obj.hit.on('mouseover', () => obj.line.setStyle({ color:'rgba(255,255,255,0.6)', weight:4 }));
        obj.hit.on('mouseout', () => obj.line.setStyle(ROAD_STYLE));
    }

    function mkRoadLine(pts) { const l=L.polyline(pts.map(p=>L.latLng(p[0],p[1])),{...ROAD_STYLE}); roadsGroup.addLayer(l); return l; }
    function mkHitLine(pts) { const l=L.polyline(pts.map(p=>L.latLng(p[0],p[1])),{color:'transparent',weight:16,opacity:0}); roadsGroup.addLayer(l); return l; }

    // ---- Routes ----
    function finishRoute() {
        if (drawPts.length >= 2) {
            const dist = calcDist(drawPts);
            const rd = { id:Date.now(), points:drawPts.map(p=>[p.lat,p.lng]), color:routeColor, distance:dist, name:`Маршрут ${routes.length+1}` };
            const lls = drawPts.map(p=>L.latLng(p.lat,p.lng));
            const line = L.polyline(lls,{color:rd.color,weight:3,opacity:0.9,lineCap:'round',lineJoin:'round'}).addTo(map);
            const dots = lls.map(p=>L.circleMarker(p,{radius:DOT,color:rd.color,fillColor:'#fff',fillOpacity:1,weight:1.5}).addTo(map));
            const hit = L.polyline(lls,{color:'transparent',weight:16,opacity:0}).addTo(map);
            const obj = { data:rd, line, hit, dots };
            attachRouteEvents(obj);
            routes.push(obj);
            toast(`${rd.name}: ${fmtDist(dist)}`,'success');
        }
        clearDraw();
    }

    function attachRouteEvents(obj) {
        const rd = obj.data;
        function del() {
            map.removeLayer(obj.line); map.removeLayer(obj.hit);
            if (obj.dots) obj.dots.forEach(d=>map.removeLayer(d));
            routes = routes.filter(r => r.data.id !== rd.id);
            toast('Маршрут удалён','info');
        }
        function mkPop() {
            const div = document.createElement('div');
            div.className = 'marker-form';
            // Header
            div.innerHTML = `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                    <div style="width:10px;height:10px;border-radius:50%;background:${rd.color};flex-shrink:0;"></div>
                    <strong style="font-size:13px;">${rd.name}</strong>
                </div>
                <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">📏 ${fmtDist(rd.distance||0)} · 📌 ${rd.points.length} точек</div>`;
            // Fuel for all bikes
            bikes.forEach(bike => {
                const f = calcFuel(rd.distance, bike);
                if (!f) return;
                const fDiv = document.createElement('div');
                fDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;';
                fDiv.innerHTML = `<div style="width:100%;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">⛽ ${bike.name}</div>`;
                const chips = [`${f.needed} л`];
                if (f.enough) chips.push(`<span class="fuel-chip ok"><span class="fuel-val">Хватит ✓</span></span>`);
                else {
                    chips.push(`<span class="fuel-chip bad"><span class="fuel-val">Не хватит</span></span>`);
                    chips.push(`<span class="fuel-chip warn"><span class="fuel-val">+${f.extra} л</span></span>`);
                }
                fDiv.innerHTML += `<span class="fuel-chip"><span class="fuel-val">${chips[0]}</span></span>`;
                for (let i=1;i<chips.length;i++) fDiv.innerHTML += chips[i];
                div.appendChild(fDiv);
            });
            // Buttons
            const btnsDiv = document.createElement('div');
            btnsDiv.className = 'marker-form-buttons';
            btnsDiv.innerHTML = `<button class="marker-btn-save">✏️ Изменить</button>
                <button class="marker-btn-save" style="background:#14b8a6">➕ Продолж.</button>
                <button class="marker-btn-save" style="background:#8b5cf6">🔗 Поделиться</button>
                <button class="marker-btn-delete">Удалить</button>`;
            const bs = btnsDiv.querySelectorAll('.marker-btn-save');
            bs[0].addEventListener('click', () => { map.closePopup(); startEdit('route', obj); });
            bs[1].addEventListener('click', () => { map.closePopup(); startEdit('route', obj); setTimeout(startContinue, 100); });
            bs[2].addEventListener('click', async () => {
                if (!currentToken) return toast('Сначала войдите в аккаунт!', 'error');
                const btn = bs[2];
                btn.textContent = '...';
                try {
                    const res = await fetch(`${API_URL}/shared`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                        body: JSON.stringify({ route: rd })
                    });
                    const d = await res.json();
                    if (!res.ok) throw new Error(d.error);
                    const link = `${window.location.origin}${window.location.pathname}?route=${d.sharedId}`;
                    navigator.clipboard.writeText(link).catch(()=>{});
                    toast('Ссылка скопирована!', 'success');
                    btn.textContent = '🔗 Поделиться';
                } catch(e) { toast('Ошибка', 'error'); btn.textContent = 'Ошибка'; }
            });
            btnsDiv.querySelector('.marker-btn-delete').addEventListener('click', del);
            div.appendChild(btnsDiv);
            return div;
        }
        obj.line.unbindPopup(); obj.hit.unbindPopup();
        obj.line.bindPopup(mkPop(), {maxWidth:280});
        obj.hit.bindPopup(mkPop(), {maxWidth:280});
    }

    // ---- Markers ----
    function mkIcon(t) { const e=ICONS[t]||ICONS.default; return L.divIcon({html:`<div class="custom-marker"><span class="custom-marker-inner">${e}</span></div>`,className:'',iconSize:[26,26],iconAnchor:[13,26],popupAnchor:[0,-28]}); }

    function addMarker(ll, data) {
        const d = data || { id:Date.now(), name:'', type:'default', lat:ll.lat, lng:ll.lng };
        const m = L.marker(ll, { icon:mkIcon(d.type), draggable:true }).addTo(map);
        function mkP() {
            const div=document.createElement('div'); div.className='marker-form';
            div.innerHTML=`<input type="text" class="marker-input" placeholder="Название..." maxlength="40" value="${d.name||''}">
                <select class="marker-select">${Object.entries(ICONS).map(([k,i])=>`<option value="${k}" ${d.type===k?'selected':''}>${i} ${LABELS[k]}</option>`).join('')}</select>
                <div class="marker-form-buttons"><button class="marker-btn-save">Сохранить</button><button class="marker-btn-delete">Удалить</button></div>`;
            div.querySelector('.marker-btn-save').addEventListener('click',()=>{d.name=div.querySelector('.marker-input').value;d.type=div.querySelector('.marker-select').value;m.setIcon(mkIcon(d.type));m.closePopup();m.setPopupContent(mkP());toast('Маркер сохранён','success');});
            div.querySelector('.marker-btn-delete').addEventListener('click',()=>{map.removeLayer(m);markers=markers.filter(x=>x.data.id!==d.id);toast('Маркер удалён','info');});
            return div;
        }
        m.bindPopup(mkP(),{maxWidth:240,closeButton:true});
        m.on('dragend',()=>{const p=m.getLatLng();d.lat=p.lat;d.lng=p.lng;});
        markers.push({marker:m,data:d});
    }

    // ---- Measurement ----
    function addMeasPt(ll) {
        measPts.push(ll);
        measDots.push(L.circleMarker(ll,{radius:DOT,color:'#3b82f6',fillColor:'#fff',fillOpacity:1,weight:1.5}).addTo(map));
        if (measLine) map.removeLayer(measLine);
        if (measPts.length>=2) measLine=L.polyline(measPts,{color:'#3b82f6',weight:2,opacity:0.7,dashArray:'6,6'}).addTo(map);
        $('info-title').textContent='Измерение'; $('info-distance').textContent=fmtDist(calcDist(measPts)); $('info-points').textContent=measPts.length;
        $('info-panel').classList.remove('hidden'); $('info-fuel').classList.add('hidden'); setFooter('draw');
    }
    function finishMeasure() { if(measLine)map.removeLayer(measLine);measLine=null;measDots.forEach(d=>map.removeLayer(d));measDots=[];measPts=[];$('info-panel').classList.add('hidden'); }

    // ---- Bikes modal ----
    const bikesModal=$('bikes-modal');
    $('btn-bikes').addEventListener('click',openBikesModal);
    $('bikes-modal-close').addEventListener('click',closeBikesModal);
    bikesModal.addEventListener('click',e=>{if(e.target===bikesModal)closeBikesModal();});
    $('bikes-add').addEventListener('click',()=>{bikes.push({id:Date.now(),name:`Мото ${bikes.length+1}`,tank:8,consumptionL:8,consumptionKm:150});saveBikes();renderBikesList();});

    function openBikesModal(){bikesModal.classList.remove('hidden');renderBikesList();}
    function closeBikesModal(){
        bikesModal.querySelectorAll('.bike-card').forEach(card=>{
            const id=parseInt(card.dataset.id),b=bikes.find(x=>x.id===id);
            if(!b)return;
            b.name=card.querySelector('[data-field="name"]').value||b.name;
            b.tank=parseFloat(card.querySelector('[data-field="tank"]').value)||b.tank;
            b.consumptionL=parseFloat(card.querySelector('[data-field="consumptionL"]').value)||b.consumptionL;
            b.consumptionKm=parseFloat(card.querySelector('[data-field="consumptionKm"]').value)||b.consumptionKm;
        });
        saveBikes();bikesModal.classList.add('hidden');toast('Настройки сохранены','success');
    }

    function renderBikesList(){
        const list=$('bikes-list');list.innerHTML='';
        bikes.forEach(bike=>{
            const card=document.createElement('div');card.className='bike-card';card.dataset.id=bike.id;
            card.innerHTML=`<div class="bike-card-header"><input class="bike-field-input" data-field="name" value="${bike.name}" style="font-weight:700;font-size:14px;border:none;background:transparent;padding:0;color:var(--text-primary);"><button class="bike-card-delete" title="Удалить">✕</button></div>
                <div class="bike-fields"><div class="bike-field"><span class="bike-field-label">Бак (л)</span><input type="number" class="bike-field-input" data-field="tank" value="${bike.tank}" min="1" max="50" step="0.5"></div>
                <div class="bike-field"><span class="bike-field-label">Расход (л)</span><input type="number" class="bike-field-input" data-field="consumptionL" value="${bike.consumptionL}" min="0.5" max="30" step="0.5"></div>
                <div class="bike-field"><span class="bike-field-label">На (км)</span><input type="number" class="bike-field-input" data-field="consumptionKm" value="${bike.consumptionKm}" min="10" max="1000" step="10"></div>
                <div class="bike-field"><span class="bike-field-label">Запас хода</span><div class="bike-field-input" style="background:transparent;border-color:transparent;color:var(--accent);font-weight:700;">${(bike.tank/(bike.consumptionL/bike.consumptionKm)).toFixed(0)} км</div></div></div>`;
            card.querySelector('.bike-card-delete').addEventListener('click',()=>{if(bikes.length<=1){toast('Нужен хотя бы один','error');return;}if(confirm(`Удалить "${bike.name}"?`)){bikes=bikes.filter(b=>b.id!==bike.id);saveBikes();renderBikesList();}});
            card.querySelectorAll('input[type="number"]').forEach(inp=>inp.addEventListener('input',()=>{
                const t=parseFloat(card.querySelector('[data-field="tank"]').value)||1,cl=parseFloat(card.querySelector('[data-field="consumptionL"]').value)||1,ck=parseFloat(card.querySelector('[data-field="consumptionKm"]').value)||1;
                card.querySelector('.bike-fields>div:last-child .bike-field-input').textContent=`${(t/(cl/ck)).toFixed(0)} км`;
            }));
            list.appendChild(card);
        });
    }

    // ---- Helpers ----
    function $(id){return document.getElementById(id);}
    function calcDist(pts){let t=0;for(let i=1;i<pts.length;i++)t+=map.distance(pts[i-1],pts[i]);return t;}
    function fmtDist(m){return m<1000?`${Math.round(m)} м`:`${(m/1000).toFixed(2)} км`;}

    // ---- Auth Modal ----
    const authModal=$('auth-modal');
    $('btn-account').addEventListener('click', () => { authModal.classList.remove('hidden'); });
    $('auth-close').addEventListener('click', () => { authModal.classList.add('hidden'); });
    
    let authMode = 'login';
    $('tab-login').addEventListener('click', () => { authMode='login'; $('tab-login').classList.add('active'); $('tab-register').classList.remove('active'); $('auth-submit').textContent='Войти'; });
    $('tab-register').addEventListener('click', () => { authMode='register'; $('tab-register').classList.add('active'); $('tab-login').classList.remove('active'); $('auth-submit').textContent='Зарегистрироваться'; });

    $('auth-submit').addEventListener('click', async () => {
        const username = $('auth-username').value.trim();
        const password = $('auth-password').value.trim();
        if (!username || !password) return toast('Введите логин и пароль', 'error');

        const btn = $('auth-submit');
        const originalText = btn.textContent;
        btn.textContent = 'Ожидание...';
        btn.disabled = true;

        try {
            const res = await fetch(`${API_URL}/${authMode}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            let data;
            try { data = await res.json(); } catch(e) { throw new Error('Ошибка связи с сервером'); }
            
            if (!res.ok) throw new Error(data.error || 'Неизвестная ошибка');

            localStorage.setItem('enduro_token', data.token);
            localStorage.setItem('enduro_user', data.username);
            currentToken = data.token; currentUser = data.username;
            toast('Успешный вход!', 'success');
            updateAuthUI();
            authModal.classList.add('hidden');
            loadFromServer();
        } catch (e) {
            console.error(e);
            if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
                toast('Сервер недоступен. Если он на Render, он может "просыпаться" до 1 минуты. Подождите...', 'error');
            } else {
                toast(`Ошибка: ${e.message}`, 'error');
            }
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });

    $('auth-logout').addEventListener('click', () => {
        localStorage.removeItem('enduro_token'); localStorage.removeItem('enduro_user');
        currentToken = null; currentUser = null;
        clearSilent(); // Clear map for next user
        updateAuthUI();
        authModal.classList.add('hidden');
        toast('Вы вышли из аккаунта', 'info');
    });

    function updateAuthUI() {
        if (currentUser) {
            $('account-name').textContent = currentUser;
            $('account-name').style.display = 'inline';
            $('auth-username').style.display = 'none';
            $('auth-password').style.display = 'none';
            $('auth-submit').style.display = 'none';
            $('auth-logout').style.display = 'flex';
            $('tab-login').style.display = 'none';
            $('tab-register').style.display = 'none';
        } else {
            $('account-name').style.display = 'none';
            $('auth-username').style.display = 'block';
            $('auth-password').style.display = 'block';
            $('auth-submit').style.display = 'flex';
            $('auth-logout').style.display = 'none';
            $('tab-login').style.display = 'block';
            $('tab-register').style.display = 'block';
        }
    }

    // ---- Friends System ----
    const friendsModal = $('friends-modal');
    if ($('btn-friends') && friendsModal) {
        $('btn-friends').addEventListener('click', () => {
            if (!currentToken) return toast('Сначала войдите в аккаунт!', 'error');
            friendsModal.classList.remove('hidden');
            loadFriends();
        });
        $('friends-close').addEventListener('click', () => friendsModal.classList.add('hidden'));
    }

    async function loadFriends() {
        if (!currentToken) return;
        try {
            const res = await fetch(`${API_URL}/friends`, { headers: { 'Authorization': `Bearer ${currentToken}` } });
            if (!res.ok) throw new Error();
            const list = await res.json();
            renderFriends(list);
        } catch(e) {}
    }

    function renderFriends(list) {
        const fl = $('friends-list');
        fl.innerHTML = '';
        if (!list.length) fl.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;">У вас пока нет друзей.</div>';
        
        list.forEach(f => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--bg-primary); padding:8px 12px; border-radius:8px; border:1px solid var(--border);';
            div.innerHTML = `<span style="font-weight:600;font-size:14px;">${f.username}</span>
                <button class="info-btn" style="width:auto; padding:4px 8px; border-color:var(--accent); color:var(--accent);">Показать маршруты</button>`;
            
            div.querySelector('button').addEventListener('click', async () => {
                toast(`Загрузка карты друга ${f.username}...`, 'info');
                try {
                    const res = await fetch(`${API_URL}/friends/${f.id}/data`, { headers: { 'Authorization': `Bearer ${currentToken}` } });
                    if (!res.ok) throw new Error();
                    const d = await res.json();
                    
                    // Draw friend's routes temporarily
                    if (d.routes) {
                        d.routes.forEach(rd => {
                            const pts = rd.points.map(p=>L.latLng(p[0],p[1]));
                            // Render with dash array to indicate it's a friend's route
                            L.polyline(pts,{color:rd.color||'#0ea5e9',weight:4,opacity:0.9,dashArray:'10,10',lineCap:'round',lineJoin:'round'})
                             .bindPopup(`<b>Маршрут друга: ${f.username}</b><br>${rd.name}`)
                             .addTo(map);
                        });
                        toast(`Маршруты друга ${f.username} добавлены на карту! (Пунктиром)`, 'success');
                        friendsModal.classList.add('hidden');
                    } else {
                        toast('У друга нет маршрутов', 'info');
                    }
                } catch(e) { toast('Ошибка загрузки', 'error'); }
            });
            fl.appendChild(div);
        });
    }

    if ($('btn-add-friend')) {
        $('btn-add-friend').addEventListener('click', async () => {
            const friendUsername = $('friend-username').value.trim();
            if (!friendUsername) return;
            try {
                const res = await fetch(`${API_URL}/friends/add`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                    body: JSON.stringify({ friendUsername })
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error);
                toast('Друг добавлен!', 'success');
                $('friend-username').value = '';
                loadFriends();
            } catch(e) { toast(e.message, 'error'); }
        });
    }

    // ---- Save / Export / Clear ----
    $('btn-save').addEventListener('click', save);
    $('btn-export').addEventListener('click', exportGPX);
    $('btn-clear').addEventListener('click', clearAll);

    async function save(){
        if(editing)finishEdit();
        const data={roads:roads.map(r=>r.data),markers:markers.map(m=>m.data),routes:routes.map(r=>r.data),center:[map.getCenter().lat,map.getCenter().lng],zoom:map.getZoom(),layer:baseLayer,labelsOn,roadsOn,savedAt:new Date().toISOString()};
        
        saveBikes(); // Bikes are local for now

        // Offline / Local save
        localStorage.setItem(STORAGE, JSON.stringify(data));
        toast(`Сохранено локально: ${roads.length} дор. · ${routes.length} маршр. · ${markers.length} маркеров`,'success');

        // Cloud save if logged in
        if (currentToken) {
            try {
                const res = await fetch(`${API_URL}/data`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                    body: JSON.stringify(data)
                });
                if (res.ok) toast('Синхронизировано с облаком ☁️', 'success');
            } catch (e) {
                console.error(e); toast('Ошибка синхронизации. Сохранено локально.', 'warn');
            }
        }
    }

    async function loadFromServer() {
        if (!currentToken) return;
        try {
            const res = await fetch(`${API_URL}/data`, { headers: { 'Authorization': `Bearer ${currentToken}` } });
            if (!res.ok) throw new Error();
            const data = await res.json();
            if (data.roads || data.routes || data.markers) {
                restore(data, false);
                localStorage.setItem(STORAGE, JSON.stringify(data)); // update local cache
            }
        } catch (e) {
            console.error('Ошибка загрузки с сервера', e);
        }
    }

    function restore(data,silent){
        try{
            clearSilent();
            if(data.center&&data.zoom)map.setView(data.center,data.zoom);
            if(data.layer&&bases[data.layer])setBase(data.layer);
            if(typeof data.labelsOn==='boolean'){labelsOn=data.labelsOn;labelsOn?labelsLayer.addTo(map):map.removeLayer(labelsLayer);btnLabels.classList.toggle('active',labelsOn);}
            if(data.roads)data.roads.forEach(rd=>{
                const line=mkRoadLine(rd.points),hit=mkHitLine(rd.points);
                const obj={data:rd,line,hit}; attachRoadEvents(obj); roads.push(obj);
            });
            if(data.markers)data.markers.forEach(md=>addMarker(L.latLng(md.lat,md.lng),md));
            if(data.routes)data.routes.forEach(rd=>{
                const pts=rd.points.map(p=>L.latLng(p[0],p[1]));
                const line=L.polyline(pts,{color:rd.color,weight:3,opacity:0.9,lineCap:'round',lineJoin:'round'}).addTo(map);
                const dots=pts.map(p=>L.circleMarker(p,{radius:DOT,color:rd.color,fillColor:'#fff',fillOpacity:1,weight:1.5}).addTo(map));
                const hit=L.polyline(pts,{color:'transparent',weight:16,opacity:0}).addTo(map);
                const obj={data:rd,line,hit,dots}; attachRouteEvents(obj); routes.push(obj);
            });
            if(!silent)toast('Загружено','success');
        }catch(e){console.error(e);if(!silent)toast('Ошибка','error');}
    }

    function exportGPX(){
        if(!markers.length&&!routes.length&&!roads.length){toast('Нет данных','error');return;}
        let g=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="EnduroMap">\n<metadata><name>Эндуро — Астраханская обл.</name></metadata>\n`;
        markers.forEach(m=>{g+=`<wpt lat="${m.data.lat}" lon="${m.data.lng}"><name>${esc(m.data.name||LABELS[m.data.type])}</name></wpt>\n`;});
        roads.forEach((r,i)=>{g+=`<trk><name>Дорога ${i+1}</name><trkseg>\n`;r.data.points.forEach(p=>{g+=`<trkpt lat="${p[0]}" lon="${p[1]}"/>\n`;});g+=`</trkseg></trk>\n`;});
        routes.forEach(r=>{g+=`<trk><name>${esc(r.data.name)}</name><trkseg>\n`;r.data.points.forEach(p=>{g+=`<trkpt lat="${p[0]}" lon="${p[1]}"/>\n`;});g+=`</trkseg></trk>\n`;});
        g+=`</gpx>`;
        const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([g],{type:'application/gpx+xml'}));a.download=`enduro_${new Date().toISOString().slice(0,10)}.gpx`;a.click();toast('GPX скачан','success');
    }
    function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

    function clearAll(){
        if(editing)finishEdit();
        const n=roads.length+markers.length+routes.length;
        if(!n){toast('Пусто','info');return;}
        if(!confirm(`Удалить всё? (${n})`))return;
        clearSilent();toast('Очищено','info');
    }
    function clearSilent(){
        roads.forEach(r=>{roadsGroup.removeLayer(r.line);roadsGroup.removeLayer(r.hit);}); roads=[];
        markers.forEach(m=>map.removeLayer(m.marker)); markers=[];
        routes.forEach(r=>{map.removeLayer(r.line);if(r.hit)map.removeLayer(r.hit);if(r.dots)r.dots.forEach(d=>map.removeLayer(d));}); routes=[];
        clearDraw(); finishMeasure();
    }

    // ---- Toast ----
    function toast(msg,type){const c=$('toast-container'),icons={success:'✅',error:'❌',info:'ℹ️'},t=document.createElement('div');t.className=`toast ${type||'info'}`;t.innerHTML=`<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${msg}</span>`;c.appendChild(t);setTimeout(()=>{t.style.animation='toastOut 300ms ease forwards';setTimeout(()=>t.remove(),300);},2500);}

    // ---- Keys ----
    document.addEventListener('keydown',e=>{
        if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
        switch(e.key){
            case 'Escape':
                if(!bikesModal.classList.contains('hidden')){closeBikesModal();break;}
                if(editing){finishEdit();break;}
                if(tool==='road')finishRoad();else if(tool==='route')finishRoute();else if(tool==='measure')finishMeasure();
                setTool('pan');break;
            case '1':if(!editing)setTool('pan');break;
            case '2':if(!editing)setTool('road');break;
            case '3':if(!editing)setTool('route');break;
            case '4':if(!editing)setTool('marker');break;
            case '5':if(!editing)setTool('measure');break;
            case 'z':if((e.ctrlKey||e.metaKey)&&!editing){e.preventDefault();undoDraw();}break;
            case 's':if(e.ctrlKey||e.metaKey){e.preventDefault();save();}break;
        }
    });

    // ---- PWA ----
    if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(e=>console.log('SW:',e));

    // ---- Check for Shared Route link ----
    async function checkSharedRoute() {
        const urlParams = new URLSearchParams(window.location.search);
        const routeId = urlParams.get('route');
        if (routeId) {
            try {
                const res = await fetch(`${API_URL}/shared/${routeId}`);
                if (!res.ok) throw new Error();
                const d = await res.json();
                
                const rd = d.route;
                const pts = rd.points.map(p=>L.latLng(p[0],p[1]));
                // Draw shared route prominently
                L.polyline(pts,{color:'#8b5cf6',weight:6,opacity:1,lineCap:'round',lineJoin:'round'})
                 .bindPopup(`<b>Поделился: ${d.owner}</b><br>${rd.name}`)
                 .addTo(map);
                 
                // Fit bounds to it
                map.fitBounds(L.latLngBounds(pts));
                toast(`Загружен маршрут от ${d.owner}!`, 'success');
                
                // Remove param from URL
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch(e) { toast('Не удалось загрузить маршрут по ссылке', 'error'); }
        }
    }

    checkSharedRoute();

    // ---- Auto-restore ----
    updateAuthUI();
    const saved=localStorage.getItem(STORAGE);
    if(saved){try{restore(JSON.parse(saved),true);}catch(e){console.error(e);}}
    
    if (currentToken) {
        loadFromServer(); // Load fresh from server if online
    }

    setTimeout(()=>toast('Эндуро Карта — Астраханская область 🏜️','success'),400);

})();
