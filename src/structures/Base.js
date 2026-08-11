'use strict';

/**
 * Represents a WhatsApp data structure
 */
class Base {
    constructor(client) {
        /**
         * The client that instantiated this
         * @readonly
         */
        Object.defineProperty(this, 'client', { value: client });
    }

    _clone() {
        return Object.assign(Object.create(this), this);
    }

    _patch(data) {
        return data;
    }

    /**
     * Returns the serialized value for WhatsApp ID objects across Web builds.
     * Some WhatsApp Web builds expose the serialized id as `$1` instead of
     * `_serialized`.
     * @param {object|string} id
     * @returns {string|undefined}
     */
    static _getSerializedId(id) {
        if (!id || typeof id === 'string') return id;
        return id._serialized || id.$1;
    }

    /**
     * Normalizes WhatsApp ID objects so downstream code can keep using
     * `_serialized`.
     * @param {object} id
     * @returns {object}
     */
    static _normalizeId(id) {
        if (id && id._serialized == null && id.$1 != null) {
            return Object.assign({}, id, { _serialized: id.$1 });
        }
        return id;
    }
}

module.exports = Base;
