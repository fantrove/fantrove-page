/**
 * seo.js — ตัวช่วย SEO สำหรับ Collection pages
 *
 * Part of: Collection Service
 * Namespace: window.CollectionModules
 *
 * Dependencies: Phase 1-2 (config.js, state.js, registry.js, loader.js)
 *
 * Public API:
 *   M.SEO — getSeoData, generateStructuredData
 */

(function (M) {
  'use strict';

  var Config = M.Config;
  var State  = M.State;
  var Loader = M.Loader;
  var Reg    = M.Registry;

  // ── SEO Module ────────────────────────────────────────────────────

  var SEO = {
    /**
     * สร้าง SEO meta data สำหรับ collection page
     *
     * @param {string} collectionId
     * @param {string} lang
     * @returns {Promise<Object>} — CollectionSEOData
     */
    getSeoData: function (collectionId, lang) {
      lang = lang || Config.SEO.DEFAULT_LANG;

      return Loader.assemble().then(function () {
        var col = State.idIndex ? State.idIndex.get(collectionId) : null;
        if (!col) return null;

        var name = Reg.getName(col.name, lang);
        var desc = Reg.getName(col.description, lang);
        var canonical = Config.SEO.BASE_URL + '/' + lang + '/collections/' + collectionId + '/';

        // hreflang alternates
        var hreflang = [];
        var supportedLangs = Config.SEO.SUPPORTED_LANGS;
        for (var i = 0; i < supportedLangs.length; i++) {
          var l = supportedLangs[i];
          hreflang.push({
            lang: l,
            href: Config.SEO.BASE_URL + '/' + l + '/collections/' + collectionId + '/',
          });
        }
        // x-default
        hreflang.push({
          lang: 'x-default',
          href: Config.SEO.BASE_URL + '/' + Config.SEO.DEFAULT_LANG + '/collections/' + collectionId + '/',
        });

        return {
          title: name + ' — Fantrove',
          description: desc,
          canonical: canonical,
          hreflang: hreflang,
          ogTitle: name + ' — Fantrove',
          ogDescription: desc,
          ogType: 'website',
          ogUrl: canonical,
        };
      });
    },

    /**
     * สร้าง JSON-LD structured data สำหรับ collection page
     *
     * @param {string} collectionId
     * @param {string} lang
     * @returns {Promise<Object>} — JSON-LD object
     */
    generateStructuredData: function (collectionId, lang) {
      lang = lang || Config.SEO.DEFAULT_LANG;

      return Loader.assemble().then(function () {
        var col = State.idIndex ? State.idIndex.get(collectionId) : null;
        if (!col) return null;

        var name = Reg.getName(col.name, lang);
        var desc = Reg.getName(col.description, lang);
        var url = Config.SEO.BASE_URL + '/' + lang + '/collections/' + collectionId + '/';
        var itemCount = col.items ? col.items.length : 0;

        // ItemList schema
        var itemListElements = [];
        if (col.items) {
          for (var i = 0; i < Math.min(col.items.length, 10); i++) {
            itemListElements.push({
              '@type': 'ListItem',
              'position': i + 1,
              'name': col.items[i],
              'url': url,
            });
          }
        }

        return {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          'name': name,
          'description': desc,
          'numberOfItems': itemCount,
          'itemListElement': itemListElements,
          'url': url,
          'inLanguage': lang,
        };
      });
    },

    /**
     * สร้าง SEO meta data แบบ static (build time)
     *
     * @param {Object} collection — CollectionData
     * @param {string} lang
     * @returns {Object}
     */
    getSeoDataStatic: function (collection, lang) {
      if (!collection) return null;
      lang = lang || Config.SEO.DEFAULT_LANG;

      var name = Reg.getName(collection.name, lang);
      var desc = Reg.getName(collection.description, lang);
      var canonical = Config.SEO.BASE_URL + '/' + lang + '/collections/' + collection.id + '/';

      var hreflang = [];
      var supportedLangs = Config.SEO.SUPPORTED_LANGS;
      for (var i = 0; i < supportedLangs.length; i++) {
        var l = supportedLangs[i];
        hreflang.push({
          lang: l,
          href: Config.SEO.BASE_URL + '/' + l + '/collections/' + collection.id + '/',
        });
      }
      hreflang.push({
        lang: 'x-default',
        href: Config.SEO.BASE_URL + '/' + Config.SEO.DEFAULT_LANG + '/collections/' + collection.id + '/',
      });

      return {
        title: name + ' — Fantrove',
        description: desc,
        canonical: canonical,
        hreflang: hreflang,
        ogTitle: name + ' — Fantrove',
        ogDescription: desc,
        ogType: 'website',
        ogUrl: canonical,
      };
    },
  };

  // ── Export ─────────────────────────────────────────────────────────

  M.SEO = SEO;

})(window.CollectionModules = window.CollectionModules || {});
