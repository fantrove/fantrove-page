// Path:    assets/js/nav-core-modules/feed.js
// Purpose: FeedService — full-coverage infinite feed สำหรับ "All" system button
//          ครอบคลุม ทุก item ในฐานข้อมูล ทั้ง button + card, สลับกันอย่างชาญฉลาด
// Used by: content.js (renderFeed → loadNextPage)

// @ts-check
(function(M) {
  'use strict';
  
  const { CONFIG } = M;
  
  // ── Constants ──────────────────────────────────────────────────────────────────
  // WHY CHUNK_SIZE_BUTTON=20: เป็นขนาดที่พอดี — ไม่เล็กเกินไป (8 เดิมเห็นน้อย)
  //   ไม่ใหญ่เกินไป (แต่ละกลุ่มก็ยังน่าสนใจ)
  // WHY CHUNK_SIZE_CARD=30: card มักมีไม่มาก — แสดงทั้ง category ในคราวเดียวเลย
  //   ถ้า category มีเยอะกว่า 30 ค่อย split เป็นหลาย segment
  const CHUNK_SIZE_BUTTON = 20;
  const CHUNK_SIZE_CARD = 30;
  
  // จำนวนรอบสูงสุดก่อนหยุด (1 รอบ = เห็นทุก item ใน DB ครั้งหนึ่ง)
  // WHY 4 รอบ: ผู้ใช้ที่ scroll จนสุดจะเห็น content ซ้ำในลำดับต่างกัน
  //   ให้ feel เหมือน infinite โดยไม่ leak memory ไม่มีที่สิ้นสุด
  const MAX_ROUNDS = 4;
  
  // ── Seeded Fisher-Yates shuffle ────────────────────────────────────────────────
  function _seededRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }
  
  function _shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  
  function _resolveName(nameObj, lang) {
    if (!nameObj || typeof nameObj !== 'object') return String(nameObj || '');
    return nameObj[lang] || nameObj.en || nameObj.th || Object.values(nameObj)[0] || '';
  }
  
  // ── Smart interleave ───────────────────────────────────────────────────────────
  // WHY: ถ้า shuffle สุ่มล้วน card อาจกระจุกอยู่ที่ใดที่หนึ่ง
  //      interleave แบบ interval ทำให้ card กระจายสม่ำเสมอตลอดฟีด
  //      ผู้ใช้เห็นความหลากหลายตลอดการ scroll ไม่ใช่ button ทั้งนั้นแล้ว card ทีเดียว
  function _interleave(buttonSegs, cardSegs, rng) {
    if (!cardSegs.length) return _shuffle(buttonSegs, rng);
    if (!buttonSegs.length) return _shuffle(cardSegs, rng);
    
    const shuffledCards = _shuffle(cardSegs, rng);
    const shuffledBtns = _shuffle(buttonSegs, rng);
    
    // คำนวณ interval: แทรก 1 card ทุก N button segment
    // WHY: ให้ card กระจายเท่าๆ กัน ไม่กระจุก
    const interval = Math.ceil(shuffledBtns.length / (shuffledCards.length + 1));
    const result = [];
    let cardIdx = 0;
    
    for (let i = 0; i < shuffledBtns.length; i++) {
      result.push(shuffledBtns[i]);
      // แทรก card หลังครบ interval (ยกเว้น card หมดแล้ว)
      if ((i + 1) % interval === 0 && cardIdx < shuffledCards.length) {
        result.push(shuffledCards[cardIdx++]);
      }
    }
    
    // card ที่เหลือ (ถ้ามี) ต่อท้าย
    while (cardIdx < shuffledCards.length) {
      result.push(shuffledCards[cardIdx++]);
    }
    
    return result;
  }
  
  // ── FeedService ────────────────────────────────────────────────────────────────
  
  const FeedService = {
    
    // ── Persistent state (ไม่ล้างเมื่อ reset เพราะแค่ rebuild ไม่ได้เปลี่ยน DB) ──
    _dbRef: null, // reference ไปยัง assembled DB (ไม่ copy)
    _copyableIds: null, // Set<string> — type IDs ที่เป็น copyable
    
    // ── Cursor state (reset() clears all) ─────────────────────────────────────
    _allSegments: [], // [{groupType,catId,catName,typeId,typeName,items}]
    _segCursor: 0,
    _roundIndex: 0,
    _totalEmitted: 0,
    _totalSegmentsPerRound: 0, // คำนวณครั้งเดียว ใช้ตรวจ hasMore
    _isInitialized: false,
    
    /**
     * Reset cursor — เรียกทุกครั้งที่กดปุ่ม All ใหม่
     * ไม่ clear _dbRef / _copyableIds (ใช้ซ้ำได้)
     */
    reset() {
      this._allSegments = [];
      this._segCursor = 0;
      this._roundIndex = 0;
      this._totalEmitted = 0;
      this._totalSegmentsPerRound = 0;
      this._isInitialized = false;
    },
    
    /**
     * สร้าง segment list ครอบคลุม ทั้ง DB (lazy init)
     * เรียกครั้งแรก: load DB + สร้าง segments
     * เรียกซ้ำ: ใช้ cache
     */
    async _ensureInit() {
      if (this._isInitialized) return;
      
      // ── Resolve type kinds ────────────────────────────────────────────────────
      // WHY: แยก copyable (emoji, symbol) กับ collection (cards) เพื่อ render ต่างกัน
      //      copyable → btn-group, collection → card-group
      if (!this._copyableIds) {
        const registry = window.ConDataService?.registry || window.ConDataRegistry || null;
        const knownKinds = registry?.knownKinds || {};
        this._copyableIds = new Set(
          Object.entries(knownKinds).filter(([, k]) => k === 'copyable').map(([id]) => id)
        );
        if (!this._copyableIds.size) {
          this._copyableIds.add('emoji');
          this._copyableIds.add('symbol');
        }
      }
      
      // ── Load DB ────────────────────────────────────────────────────────────────
      const db = await M.DataService.loadApiDatabase();
      this._dbRef = db;
      
      // ── Build segments ─────────────────────────────────────────────────────────
      // สร้าง segment จากทุก type ทุก category ไม่มีการคัดออก
      const buttonSegs = [];
      const cardSegs = [];
      
      for (const typeObj of (db?.type || [])) {
        const isCopyable = this._copyableIds.has(typeObj.id);
        const isCollection = !isCopyable;
        
        for (const cat of (typeObj.category || [])) {
          if (!cat.data?.length) continue;
          
          const chunkSize = isCollection ? CHUNK_SIZE_CARD : CHUNK_SIZE_BUTTON;
          const groupType = isCollection ? 'card' : 'button';
          
          // Split category items into chunks → each chunk = 1 segment
          for (let offset = 0; offset < cat.data.length; offset += chunkSize) {
            const slice = cat.data.slice(offset, offset + chunkSize);
            if (!slice.length) continue;
            
            const seg = {
              groupType,
              typeId: typeObj.id,
              typeName: typeObj.name,
              catId: cat.id,
              catName: cat.name,
              items: slice, // ref slice — ไม่ copy object ใหม่
            };
            
            if (isCollection) cardSegs.push(seg);
            else buttonSegs.push(seg);
          }
        }
      }
      
      // WHY เก็บแยก: เพื่อทำ smart interleave — ไม่ใช่ shuffle สุ่มล้วน
      // เก็บไว้เพื่อ re-interleave ในรอบถัดไปด้วย seed ต่าง
      this._buttonSegsSource = buttonSegs;
      this._cardSegsSource = cardSegs;
      
      // สร้าง interleaved segments สำหรับ round 0
      this._totalSegmentsPerRound = buttonSegs.length + cardSegs.length;
      this._allSegments = this._buildRoundSegments(0);
      this._isInitialized = true;
    },
    
    // สร้าง interleaved + shuffled segment list สำหรับ round ที่กำหนด
    // WHY แยก method: เรียกซ้ำเมื่อเริ่ม round ใหม่
    _buildRoundSegments(roundIndex) {
      if (!this._buttonSegsSource?.length && !this._cardSegsSource?.length) return [];
      const rng = _seededRng((roundIndex * 98317 + 11) >>> 0);
      return _interleave(
        this._buttonSegsSource || [],
        this._cardSegsSource || [],
        rng
      );
    },
    
    /**
     * Load N segments ถัดไปสำหรับ feed.
     * เรียกได้ต่อเนื่อง — cursor เดินหน้าอัตโนมัติ
     * เมื่อครบ round: re-shuffle + เริ่ม round ใหม่
     *
     * @param {string} lang
     * @param {number} [n=12]
     * @returns {Promise<{groups: Array, hasMore: boolean}>}
     */
    async loadNextPage(lang, n = 12) {
      await this._ensureInit();
      if (!this._totalSegmentsPerRound) return { groups: [], hasMore: false };
      
      const maxEmit = this._totalSegmentsPerRound * MAX_ROUNDS;
      const groups = [];
      
      for (let i = 0; i < n; i++) {
        if (this._totalEmitted >= maxEmit) break;
        
        // Wrap round เมื่อ cursor เดินถึงปลาย allSegments
        if (this._segCursor >= this._allSegments.length) {
          this._roundIndex++;
          // WHY re-build: round ใหม่ = shuffle order ใหม่ = ลำดับ content ต่าง
          //   ผู้ใช้ที่ scroll ผ่านครบ 1 รอบจะเห็น content เดิมในลำดับใหม่
          this._allSegments = this._buildRoundSegments(this._roundIndex);
          this._segCursor = 0;
          if (!this._allSegments.length) break;
        }
        
        const seg = this._allSegments[this._segCursor];
        const group = this._buildGroup(seg, lang);
        if (group) groups.push(group);
        
        this._segCursor++;
        this._totalEmitted++;
      }
      
      const hasMore = (this._totalEmitted < maxEmit) && (this._totalSegmentsPerRound > 0);
      return { groups, hasMore };
    },
    
    // แปลง segment → group descriptor ในรูปแบบที่ ContentService._resolveAll() รับได้
    // WHY: ส่ง groupType ไปใน group.type เพื่อให้ _resolveGroup รู้ว่าจะ render แบบไหน
    //   'card' → card-group template (รูปภาพ + ชื่อ + description)
    //   'button' → btn-group template (ตัวอักขระ/emoji แบบกริด)
    _buildGroup(seg, lang) {
      if (!seg?.items?.length) return null;
      return {
        group: {
          type: seg.groupType,
          header: {
            title: _resolveName(seg.catName, lang),
            description: _resolveName(seg.typeName, lang),
            className: 'auto-category-header',
          },
          items: seg.items, // ref — ไม่ allocate ใหม่
        },
      };
    },
    
    /** Invalidate — เรียกเมื่อเปลี่ยนภาษา (header ต้อง resolve ใหม่) */
    invalidate() { this.reset(); },
  };
  
  // ── Export ──────────────────────────────────────────────────────────────────────
  M.FeedService = FeedService;
  
})(window.NavCoreModules = window.NavCoreModules || {});