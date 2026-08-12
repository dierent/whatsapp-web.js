'use strict';

exports.LoadUtils = () => {
    window.WWebJS = {};

    /**
     * Returns the serialized value for WhatsApp ID objects across Web builds.
     * Recent WhatsApp Web builds can expose `$1` where older builds exposed
     * `_serialized`.
     * @param {object|string} id
     * @returns {string|undefined}
     */
    const getSerializedId = (id) => {
        if (!id || typeof id === 'string') return id;
        return id._serialized || id.$1;
    };

    /**
     * Normalizes WhatsApp ID objects so public models keep `_serialized`.
     * @param {object} id
     * @returns {object}
     */
    const normalizeId = (id) =>
        id && id._serialized == null && id.$1 != null
            ? Object.assign({}, id, { _serialized: id.$1 })
            : id;

    const isDiagnosticLoggingEnabled = () => {
        try {
            return (
                window.WWEBJS_DEBUG === true ||
                window.localStorage?.getItem('WWEBJS_DEBUG') === '1'
            );
        } catch (ignoredError) {
            return false;
        }
    };

    const getDiagnosticContext = () => {
        try {
            return window.__waMediaDiagnosticContext || {};
        } catch (ignoredError) {
            return {};
        }
    };

    const logDiagnostic = (stage, details = {}) => {
        if (!isDiagnosticLoggingEnabled()) return;
        const context = getDiagnosticContext();
        let payload;
        try {
            payload = JSON.stringify({
                traceId: context.traceId || '',
                taskId: context.taskId || '',
                chatId: context.chatId || '',
                ...details,
            });
        } catch (ignoredError) {
            payload = '"[unserializable]"';
        }
        console.warn(`[whatsapp-web.js] ${stage} ${payload}`);
    };

    /**
     * Adds a bounded wait around WhatsApp Web internal promises so library calls
     * fail with a useful stage label instead of hanging indefinitely.
     * @param {Promise<*>} promise
     * @param {number} timeoutMs
     * @param {string} stage
     * @returns {Promise<*>}
     */
    const withTimeout = (promise, timeoutMs, stage) => {
        if (!timeoutMs || timeoutMs <= 0) return promise;

        let timeoutId;
        const timeoutPromise = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                logDiagnostic('timeout', { stage, timeoutMs });
                const error = new Error(
                    `WhatsApp Web internal operation timed out: stage=${stage}, timeoutMs=${timeoutMs}`,
                );
                error.name = 'WWebJSTimeoutError';
                reject(error);
            }, timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]).finally(() => {
            clearTimeout(timeoutId);
        });
    };

    const safeMediaSummary = (mediaInfo = {}) => ({
        mimetype: mediaInfo.mimetype || '',
        filename: mediaInfo.filename || '',
        dataLength: mediaInfo.data?.length || 0,
        filesize: mediaInfo.filesize || '',
    });

    const getUploadPromiseCount = (mediaObject) => {
        try {
            return typeof mediaObject?.getUploadPromises === 'function'
                ? mediaObject.getUploadPromises().length
                : '';
        } catch (error) {
            return `error:${error?.message || String(error)}`;
        }
    };

    const getMms4UploadHosts = () => {
        try {
            const raw = window.localStorage?.getItem('WAMms4Conn');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return (parsed.hosts || [])
                .filter((host) =>
                    (host.rules || []).some((rule) =>
                        Array.isArray(rule.upload),
                    ),
                )
                .map((host) => ({
                    hostname: host.hostname || '',
                    type: host.type || '',
                    fallbackHostname: host.fallback?.hostname || '',
                    uploadTypes: (host.rules || [])
                        .flatMap((rule) => rule.upload || [])
                        .slice(0, 40),
                }))
                .slice(0, 12);
        } catch (error) {
            return [{ error: error?.message || String(error) }];
        }
    };

    const getMediaObjectSummary = (mediaObject) => ({
        filehash: mediaObject?.filehash || '',
        type: mediaObject?.type || '',
        size: mediaObject?.size || '',
        hasMediaBlob: Boolean(mediaObject?.mediaBlob),
        mediaBlobType: mediaObject?.mediaBlob?.type || '',
        mediaBlobSize: mediaObject?.mediaBlob?.size || '',
        hasMediaBlobFormData:
            typeof mediaObject?.mediaBlob?.formData === 'function',
        uploadPromiseCount: getUploadPromiseCount(mediaObject),
    });

    const withUploadTimeout = (promise, timeoutMs, stage, cancelUpload) => {
        if (!timeoutMs || timeoutMs <= 0) return promise;

        let timeoutId;
        const timeoutPromise = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                let cancelResult = 'not-run';
                try {
                    cancelUpload?.();
                    cancelResult = 'called';
                } catch (error) {
                    cancelResult = `error:${error?.message || String(error)}`;
                }
                logDiagnostic('timeout', { stage, timeoutMs, cancelResult });
                const error = new Error(
                    `WhatsApp Web internal operation timed out: stage=${stage}, timeoutMs=${timeoutMs}`,
                );
                error.name = 'WWebJSTimeoutError';
                reject(error);
            }, timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]).finally(() => {
            clearTimeout(timeoutId);
        });
    };

    window.WWebJS.getSerializedId = getSerializedId;
    window.WWebJS.normalizeId = normalizeId;
    window.WWebJS.logDiagnostic = logDiagnostic;
    window.WWebJS.withTimeout = withTimeout;

    /**
     * Retrieves a message model using the current and fallback collection paths.
     * @param {string} msgId
     * @returns {Promise<object|null>}
     */
    window.WWebJS.getMsgById = async (msgId) => {
        if (!msgId) return null;
        const Msg = window.require('WAWebCollections').Msg;
        try {
            const cached = Msg.get(msgId);
            if (cached) return cached;

            logDiagnostic('getMsgById.fallback', { msgId });
            const fetched =
                (await Msg.getMessagesById([msgId]))?.messages?.[0] || null;
            if (!fetched) logDiagnostic('getMsgById.notFound', { msgId });
            return fetched;
        } catch (error) {
            logDiagnostic('getMsgById.error', {
                msgId,
                name: error?.name,
                message: error?.message,
            });
            return null;
        }
    };

    /**
     * Helper function that compares between two WWeb versions. Its purpose is to help the developer to choose the correct code implementation depending on the comparison value and the WWeb version.
     * @param {string} lOperand The left operand for the WWeb version string to compare with
     * @param {string} operator The comparison operator
     * @param {string} rOperand The right operand for the WWeb version string to compare with
     * @returns {boolean} Boolean value that indicates the result of the comparison
     */
    window.WWebJS.compareWwebVersions = (lOperand, operator, rOperand) => {
        if (!['>', '>=', '<', '<=', '='].includes(operator)) {
            throw new (class _ extends Error {
                constructor(m) {
                    super(m);
                    this.name = 'CompareWwebVersionsError';
                }
            })('Invalid comparison operator is provided');
        }
        if (typeof lOperand !== 'string' || typeof rOperand !== 'string') {
            throw new (class _ extends Error {
                constructor(m) {
                    super(m);
                    this.name = 'CompareWwebVersionsError';
                }
            })('A non-string WWeb version type is provided');
        }

        lOperand = lOperand.replace(/-beta$/, '');
        rOperand = rOperand.replace(/-beta$/, '');

        while (lOperand.length !== rOperand.length) {
            lOperand.length > rOperand.length
                ? (rOperand = rOperand.concat('0'))
                : (lOperand = lOperand.concat('0'));
        }

        lOperand = Number(lOperand.replace(/\./g, ''));
        rOperand = Number(rOperand.replace(/\./g, ''));

        return operator === '>'
            ? lOperand > rOperand
            : operator === '>='
              ? lOperand >= rOperand
              : operator === '<'
                ? lOperand < rOperand
                : operator === '<='
                  ? lOperand <= rOperand
                  : operator === '='
                    ? lOperand === rOperand
                    : false;
    };

    /**
     * Target options object description
     * @typedef {Object} TargetOptions
     * @property {string|number} module The target module
     * @property {string} function The function name to get from a module
     */
    /**
     * Function to modify functions
     * @param {TargetOptions} target Options specifying the target function to search for modifying
     * @param {Function} callback Modified function
     */
    window.WWebJS.injectToFunction = (target, callback) => {
        try {
            let module = window.require(target.module);
            if (!module) return;

            const path = target.function.split('.');
            const funcName = path.pop();

            for (const key of path) {
                if (!module[key]) return;
                module = module[key];
            }

            const originalFunction = module[funcName];
            if (typeof originalFunction !== 'function') return;

            module[funcName] = ((...args) => {
                try {
                    return callback(module, originalFunction, ...args);
                } catch {
                    return originalFunction.apply(module, args);
                }
            }).bind(module);
        } catch {
            return;
        }
    };

    window.WWebJS.injectToFunction(
        { module: 'WAWebBackendJobsCommon', function: 'mediaTypeFromProtobuf' },
        (module, func, ...args) => {
            const [proto] = args;
            return proto.locationMessage ? null : func(...args);
        },
    );

    window.WWebJS.injectToFunction(
        { module: 'WAWebE2EProtoUtils', function: 'typeAttributeFromProtobuf' },
        (module, func, ...args) => {
            const [proto] = args;
            return proto.locationMessage || proto.groupInviteMessage
                ? 'text'
                : func(...args);
        },
    );

    window.WWebJS.forwardMessage = async (chatId, msgId) => {
        const msg = await window.WWebJS.getMsgById(msgId);
        const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        return await window.require('WAWebChatForwardMessage').forwardMessages({
            chat: chat,
            msgs: [msg],
            multicast: true,
            includeCaption: true,
            appendedText: undefined,
        });
    };

    window.WWebJS.sendSeen = async (chatId) => {
        const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        if (chat) {
            window.require('WAWebStreamModel').Stream.markAvailable();
            await window.require('WAWebUpdateUnreadChatAction').sendSeen({
                chat: chat,
                threadId: undefined,
            });
            window.require('WAWebStreamModel').Stream.markUnavailable();
            return true;
        }
        return false;
    };

    window.WWebJS.sendMessage = async (chat, content, options = {}) => {
        const sendStartedAt = Date.now();
        const { getIsNewsletter, getIsBroadcast } =
            window.require('WAWebChatGetters');
        const isChannel = getIsNewsletter(chat);
        const isStatus = getIsBroadcast(chat);

        const { findLink } = window.require('WALinkify');
        const mediaTimeoutMs =
            options.mediaSendTimeoutMs ||
            options.mediaUploadTimeoutMs ||
            120000;
        const mediaUploadTimeoutMs =
            options.mediaUploadTimeoutMs || mediaTimeoutMs;
        const mediaPrepTimeoutMs =
            options.mediaPrepTimeoutMs || Math.min(mediaTimeoutMs, 60000);
        const mediaProcessTimeoutMs =
            mediaPrepTimeoutMs + mediaUploadTimeoutMs + 10000;
        const messageTimeoutMs = options.messageSendTimeoutMs || 120000;
        delete options.mediaSendTimeoutMs;
        delete options.mediaUploadTimeoutMs;
        delete options.mediaPrepTimeoutMs;
        delete options.messageSendTimeoutMs;

        logDiagnostic('sendMessage.start', {
            chatId: getSerializedId(chat.id),
            contentType: typeof content,
            hasMedia: !!options.media,
            isChannel,
            isStatus,
            mediaTimeoutMs,
            mediaUploadTimeoutMs,
            mediaPrepTimeoutMs,
            mediaProcessTimeoutMs,
            messageTimeoutMs,
            sendMediaAsDocument: !!options.sendMediaAsDocument,
            waitUntilMsgSent: !!options.waitUntilMsgSent,
        });

        let mediaOptions = {};
        if (options.media) {
            logDiagnostic('sendMessage.media.start', {
                chatId: getSerializedId(chat.id),
                mimetype: options.media.mimetype,
                filename: options.media.filename,
                dataLength: options.media.data?.length || 0,
                filesize: options.media.filesize || '',
                sendMediaAsDocument: !!options.sendMediaAsDocument,
                sendMediaAsSticker: !!options.sendMediaAsSticker,
            });
            mediaOptions =
                options.sendMediaAsSticker && !isChannel && !isStatus
                    ? await withTimeout(
                          window.WWebJS.processStickerData(options.media),
                          mediaTimeoutMs,
                          'processStickerData',
                      )
                    : await withTimeout(
                          window.WWebJS.processMediaData(options.media, {
                              forceSticker: options.sendMediaAsSticker,
                              forceGif: options.sendVideoAsGif,
                              forceVoice: options.sendAudioAsVoice,
                              forceDocument: options.sendMediaAsDocument,
                              forceMediaHd: options.sendMediaAsHd,
                              sendToChannel: isChannel,
                              sendToStatus: isStatus,
                              mediaPrepTimeoutMs,
                              mediaUploadTimeoutMs,
                          }),
                          mediaProcessTimeoutMs,
                          'processMediaData',
                      );
            logDiagnostic('sendMessage.media.processed', {
                chatId: getSerializedId(chat.id),
                type: mediaOptions.type,
                mimetype: mediaOptions.mimetype,
                size: mediaOptions.size,
                filehash: mediaOptions.filehash,
                hasClientUrl: !!mediaOptions.clientUrl,
                hasDirectPath: !!mediaOptions.directPath,
            });
            mediaOptions.caption = options.caption;
            content = options.sendMediaAsSticker
                ? undefined
                : mediaOptions.preview;
            mediaOptions.isViewOnce = options.isViewOnce;
            delete options.media;
            delete options.sendMediaAsSticker;
        }

        let quotedMsgOptions = {};
        if (options.quotedMessageId) {
            const quotedMessage = await window.WWebJS.getMsgById(
                options.quotedMessageId,
            );
            if (quotedMessage) {
                const ReplyUtils = window.require('WAWebMsgReply');
                const canReply = ReplyUtils
                    ? ReplyUtils.canReplyMsg(quotedMessage.unsafe())
                    : quotedMessage.canReply();

                if (canReply) {
                    quotedMsgOptions = quotedMessage.msgContextInfo(chat);
                }
            } else {
                if (!options.ignoreQuoteErrors) {
                    throw new Error('Could not get the quoted message.');
                }
            }

            delete options.ignoreQuoteErrors;
            delete options.quotedMessageId;
        }

        if (options.mentionedJidList) {
            options.mentionedJidList = options.mentionedJidList.map((id) =>
                window.require('WAWebWidFactory').createWid(id),
            );
            options.mentionedJidList = options.mentionedJidList.filter(Boolean);
        }

        if (options.groupMentions) {
            options.groupMentions = options.groupMentions.map((e) => ({
                groupSubject: e.subject,
                groupJid: window.require('WAWebWidFactory').createWid(e.id),
            }));
        }

        let locationOptions = {};
        if (options.location) {
            let { latitude, longitude, description, url } = options.location;
            url = findLink(url)?.href;
            url && !description && (description = url);
            locationOptions = {
                type: 'location',
                loc: description,
                lat: latitude,
                lng: longitude,
                clientUrl: url,
            };
            delete options.location;
        }

        let pollOptions = {};
        if (options.poll) {
            const { pollName, pollOptions: _pollOptions } = options.poll;
            const { allowMultipleAnswers, messageSecret } =
                options.poll.options;
            pollOptions = {
                kind: 'pollCreation',
                type: 'poll_creation',
                pollName: pollName,
                pollOptions: _pollOptions,
                pollSelectableOptionsCount: allowMultipleAnswers ? 0 : 1,
                messageSecret:
                    Array.isArray(messageSecret) && messageSecret.length === 32
                        ? new Uint8Array(messageSecret)
                        : window.crypto.getRandomValues(new Uint8Array(32)),
            };
            delete options.poll;
        }

        let eventOptions = {};
        if (options.event) {
            const { name, startTimeTs, eventSendOptions } = options.event;
            const { messageSecret } = eventSendOptions;
            eventOptions = {
                type: 'event_creation',
                eventName: name,
                eventDescription: eventSendOptions.description,
                eventStartTime: startTimeTs,
                eventEndTime: eventSendOptions.endTimeTs,
                eventLocation: eventSendOptions.location && {
                    degreesLatitude: 0,
                    degreesLongitude: 0,
                    name: eventSendOptions.location,
                },
                eventJoinLink:
                    eventSendOptions.callType === 'none'
                        ? null
                        : await window
                              .require('WAWebGenerateEventCallLink')
                              .createEventCallLink(
                                  startTimeTs,
                                  eventSendOptions.callType,
                              ),
                isEventCanceled: eventSendOptions.isEventCanceled,
                messageSecret:
                    Array.isArray(messageSecret) && messageSecret.length === 32
                        ? new Uint8Array(messageSecret)
                        : window.crypto.getRandomValues(new Uint8Array(32)),
            };
            delete options.event;
        }

        let vcardOptions = {};
        if (options.contactCard) {
            let contact = await window
                .require('WAWebCollections')
                .Contact.find(options.contactCard);
            vcardOptions = {
                body: window
                    .require('WAWebFrontendVcardUtils')
                    .vcardFromContactModel(contact).vcard,
                type: 'vcard',
                vcardFormattedName: contact.formattedName,
            };
            delete options.contactCard;
        } else if (options.contactCardList) {
            let contacts = await Promise.all(
                options.contactCardList.map((c) =>
                    window.require('WAWebCollections').Contact.find(c),
                ),
            );
            let vcards = contacts.map((c) =>
                window
                    .require('WAWebFrontendVcardUtils')
                    .vcardFromContactModel(c),
            );
            vcardOptions = {
                type: 'multi_vcard',
                vcardList: vcards,
                body: null,
            };
            delete options.contactCardList;
        } else if (
            options.parseVCards &&
            typeof content === 'string' &&
            content.startsWith('BEGIN:VCARD')
        ) {
            delete options.parseVCards;
            delete options.linkPreview;
            try {
                const parsed = window
                    .require('WAWebVcardParsingUtils')
                    .parseVcard(content);
                if (parsed) {
                    vcardOptions = {
                        type: 'vcard',
                        vcardFormattedName: window
                            .require('WAWebVcardGetNameFromParsed')
                            .vcardGetNameFromParsed(parsed),
                    };
                }
            } catch (ignoredError) {
                // not a vcard
            }
        }

        if (options.linkPreview) {
            delete options.linkPreview;
            const link = findLink(content);
            if (link) {
                let preview = await window
                    .require('WAWebLinkPreviewChatAction')
                    .getLinkPreview(link);
                if (preview && preview.data) {
                    preview = preview.data;
                    preview.preview = true;
                    preview.subtype = 'url';
                    options = { ...options, ...preview };
                }
            }
        }

        let buttonOptions = {};
        if (options.buttons) {
            let caption;
            if (options.buttons.type === 'chat') {
                content = options.buttons.body;
                caption = content;
            } else {
                caption = options.caption ? options.caption : ' '; // Caption can't be empty
            }
            buttonOptions = {
                productHeaderImageRejected: false,
                isFromTemplate: false,
                isDynamicReplyButtonsMsg: true,
                title: options.buttons.title
                    ? options.buttons.title
                    : undefined,
                footer: options.buttons.footer
                    ? options.buttons.footer
                    : undefined,
                dynamicReplyButtons: options.buttons.buttons,
                replyButtons: options.buttons.buttons,
                caption: caption,
            };
            delete options.buttons;
        }

        let listOptions = {};
        if (options.list) {
            if (
                window.require('WAWebConnModel').Conn.platform === 'smba' ||
                window.require('WAWebConnModel').Conn.platform === 'smbi'
            ) {
                throw "[LT01] Whatsapp business can't send this yet";
            }
            listOptions = {
                type: 'list',
                footer: options.list.footer,
                list: {
                    ...options.list,
                    listType: 1,
                },
                body: options.list.description,
            };
            delete options.list;
            delete listOptions.list.footer;
        }

        const botOptions = {};
        if (options.invokedBotWid) {
            botOptions.messageSecret = window.crypto.getRandomValues(
                new Uint8Array(32),
            );
            botOptions.botMessageSecret = await window
                .require('WAWebBotMessageSecret')
                .genBotMsgSecretFromMsgSecret(botOptions.messageSecret);
            botOptions.invokedBotWid = window
                .require('WAWebWidFactory')
                .createWid(options.invokedBotWid);
            botOptions.botPersonaId = window
                .require('WAWebBotProfileCollection')
                .BotProfileCollection.get(options.invokedBotWid).personaId;
            delete options.invokedBotWid;
        }
        const { getMaybeMeLidUser, getMaybeMePnUser } = window.require(
            'WAWebUserPrefsMeUser',
        );
        const lidUser = getMaybeMeLidUser();
        const meUser = getMaybeMePnUser();
        const newId = await window.require('WAWebMsgKey').newId();
        let from = chat.id.isLid() ? lidUser : meUser;
        let participant;

        if (typeof chat.id?.isGroup === 'function' && chat.id.isGroup()) {
            from =
                chat.groupMetadata && chat.groupMetadata.isLidAddressingMode
                    ? lidUser
                    : meUser;
            participant = window
                .require('WAWebWidFactory')
                .asUserWidOrThrow(from);
        }

        if (typeof chat.id?.isStatus === 'function' && chat.id.isStatus()) {
            participant = window
                .require('WAWebWidFactory')
                .asUserWidOrThrow(from);
        }

        const newMsgKey = new (window.require('WAWebMsgKey'))({
            from: from,
            to: chat.id,
            id: newId,
            participant: participant,
            selfDir: 'out',
        });

        const extraOptions = options.extraOptions || {};
        delete options.extraOptions;

        const ephemeralFields = window
            .require('WAWebGetEphemeralFieldsMsgActionsUtils')
            .getEphemeralFields(chat);

        const message = {
            ...options,
            id: newMsgKey,
            ack: 0,
            body: content,
            from: from,
            to: chat.id,
            local: true,
            self: 'out',
            t: parseInt(new Date().getTime() / 1000),
            isNewMsg: true,
            type: 'chat',
            ...ephemeralFields,
            ...mediaOptions,
            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),
            ...quotedMsgOptions,
            ...locationOptions,
            ...pollOptions,
            ...eventOptions,
            ...vcardOptions,
            ...buttonOptions,
            ...listOptions,
            ...botOptions,
            ...extraOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)
        if (botOptions) {
            delete message.canonicalUrl;
        }

        if (isChannel) {
            const msg = new (window.require('WAWebCollections').Msg.modelClass)(
                message,
            );
            const msgDataFromMsgModel = window
                .require('WAWebMsgDataFromModel')
                .msgDataFromMsgModel(msg);
            const isMedia = Object.keys(mediaOptions).length > 0;
            await window
                .require('WAWebNewsletterUpdateMsgsRecordsJob')
                .addNewsletterMsgsRecords([msgDataFromMsgModel]);
            chat.msgs.add(msg);
            chat.t = msg.t;

            const sendChannelMsgResponse = await window
                .require('WAWebNewsletterSendMessageJob')
                .sendNewsletterMessageJob({
                    msg: msg,
                    type:
                        message.type === 'chat'
                            ? 'text'
                            : isMedia
                              ? 'media'
                              : 'pollCreation',
                    newsletterJid: chat.id.toJid(),
                    ...(isMedia
                        ? {
                              mediaMetadata: msg.avParams(),
                              mediaHandle: isMedia
                                  ? mediaOptions.mediaHandle
                                  : null,
                          }
                        : {}),
                });

            if (sendChannelMsgResponse.success) {
                msg.t = sendChannelMsgResponse.ack.t;
                msg.serverId = sendChannelMsgResponse.serverId;
            }
            msg.updateAck(1, true);
            await window
                .require('WAWebNewsletterUpdateMsgsRecordsJob')
                .updateNewsletterMsgRecord(msg);
            return msg;
        }

        if (isStatus) {
            const { backgroundColor, fontStyle } = extraOptions;
            const isMedia = Object.keys(mediaOptions).length > 0;
            const mediaUpdate = (data) =>
                window.require('WAWebMediaUpdateMsg')(data, mediaOptions);
            const msg = new (window.require('WAWebCollections').Msg.modelClass)(
                {
                    ...message,
                    author: participant ? participant : null,
                    messageSecret: window.crypto.getRandomValues(
                        new Uint8Array(32),
                    ),
                    cannotBeRanked: window
                        .require('WAWebStatusGatingUtils')
                        .canCheckStatusRankingPosterGating(),
                },
            );

            // for text only
            const statusOptions = {
                color:
                    (backgroundColor &&
                        window.WWebJS.assertColor(backgroundColor)) ||
                    0xff7acca5,
                font: (fontStyle >= 0 && fontStyle <= 7 && fontStyle) || 0,
                text: msg.body,
            };

            await window
                .require('WAWebSendStatusMsgAction')
                [
                    isMedia
                        ? 'sendStatusMediaMsgAction'
                        : 'sendStatusTextMsgAction'
                ](...(isMedia ? [msg, mediaUpdate] : [statusOptions]));

            return msg;
        }

        logDiagnostic('sendMessage.message.created', {
            chatId: getSerializedId(chat.id),
            msgId: getSerializedId(newMsgKey),
            newId,
            type: message.type,
            bodyType: typeof message.body,
            mediaType: mediaOptions.type || '',
            mimetype: mediaOptions.mimetype || '',
            hasClientUrl: !!mediaOptions.clientUrl,
            hasDirectPath: !!mediaOptions.directPath,
            hasUploadhash: !!mediaOptions.uploadhash,
        });

        logDiagnostic('sendMessage.addAndSend.start', {
            chatId: getSerializedId(chat.id),
            msgId: getSerializedId(newMsgKey),
            messageTimeoutMs,
        });
        const [msgPromise, sendMsgResultPromise] = window
            .require('WAWebSendMsgChatAction')
            .addAndSendMsgToChat(chat, message);
        logDiagnostic('sendMessage.addAndSend.promises', {
            chatId: getSerializedId(chat.id),
            msgId: getSerializedId(newMsgKey),
            hasMsgPromise: !!msgPromise,
            hasSendMsgResultPromise: !!sendMsgResultPromise,
        });
        await withTimeout(
            msgPromise,
            messageTimeoutMs,
            'addAndSendMsgToChat.message',
        );
        logDiagnostic('sendMessage.addAndSend.messageResolved', {
            chatId: getSerializedId(chat.id),
            msgId: getSerializedId(newMsgKey),
        });

        if (options.waitUntilMsgSent) {
            await withTimeout(
                sendMsgResultPromise,
                messageTimeoutMs,
                'addAndSendMsgToChat.result',
            );
            logDiagnostic('sendMessage.addAndSend.resultResolved', {
                chatId: getSerializedId(chat.id),
                msgId: getSerializedId(newMsgKey),
            });
        }

        const Msg = window.require('WAWebCollections').Msg;
        const newMsgKeyId = getSerializedId(newMsgKey);
        const sentMsg = Msg.get(newMsgKeyId);
        if (sentMsg) {
            logDiagnostic('sendMessage.returnMessage.cache', {
                msgId: newMsgKeyId,
                newId,
            });
            return sentMsg;
        }

        const fallbackMsg =
            chat.msgs
                ?.getModelsArray()
                .find((msg) => msg.id && msg.id.id === newId) || null;
        logDiagnostic(
            fallbackMsg
                ? 'sendMessage.returnMessage.fallback'
                : 'sendMessage.returnMessage.notFound',
            {
                msgId: newMsgKeyId,
                newId,
                elapsedMs: Date.now() - sendStartedAt,
            },
        );
        return fallbackMsg;
    };

    window.WWebJS.editMessage = async (msg, content, options = {}) => {
        const extraOptions = options.extraOptions || {};
        delete options.extraOptions;

        if (options.mentionedJidList) {
            options.mentionedJidList = options.mentionedJidList.map((id) =>
                window.require('WAWebWidFactory').createWid(id),
            );
            options.mentionedJidList = options.mentionedJidList.filter(Boolean);
        }

        if (options.groupMentions) {
            options.groupMentions = options.groupMentions.map((e) => ({
                groupSubject: e.subject,
                groupJid: window.require('WAWebWidFactory').createWid(e.id),
            }));
        }

        if (options.linkPreview) {
            const { findLink } = window.require('WALinkify');
            delete options.linkPreview;
            const link = findLink(content);
            if (link) {
                const preview = await window
                    .require('WAWebLinkPreviewChatAction')
                    .getLinkPreview(link);
                preview.preview = true;
                preview.subtype = 'url';
                options = { ...options, ...preview };
            }
        }

        const internalOptions = {
            ...options,
            ...extraOptions,
        };

        await window
            .require('WAWebSendMessageEditAction')
            .sendMessageEdit(msg, content, internalOptions);
        return window
            .require('WAWebCollections')
            .Msg.get(getSerializedId(msg.id));
    };

    window.WWebJS.toStickerData = async (mediaInfo) => {
        if (mediaInfo.mimetype == 'image/webp') return mediaInfo;

        const file = window.WWebJS.mediaInfoToFile(mediaInfo);
        const webpSticker = await window
            .require('WAWebImageUtils')
            .toWebpSticker(file);
        const webpBuffer = await webpSticker.arrayBuffer();
        const data = window.WWebJS.arrayBufferToBase64(webpBuffer);

        return {
            mimetype: 'image/webp',
            data,
        };
    };

    window.WWebJS.processStickerData = async (mediaInfo) => {
        if (mediaInfo.mimetype !== 'image/webp')
            throw new Error('Invalid media type');

        const file = window.WWebJS.mediaInfoToFile(mediaInfo);
        let filehash = await window.WWebJS.getFileHash(file);
        let mediaKey = await window.WWebJS.generateHash(32);

        const controller = new AbortController();
        const uploadedInfo = await window
            .require('WAWebUploadManager')
            .encryptAndUpload({
                blob: file,
                type: 'sticker',
                signal: controller.signal,
                mediaKey,
                uploadQpl: window
                    .require('WAWebStartMediaUploadQpl')
                    .startMediaUploadQpl({
                        entryPoint: 'MediaUpload',
                    }),
            });

        const stickerInfo = {
            ...uploadedInfo,
            clientUrl: uploadedInfo.url,
            deprecatedMms3Url: uploadedInfo.url,
            uploadhash: uploadedInfo.encFilehash,
            size: file.size,
            type: 'sticker',
            filehash,
        };

        return stickerInfo;
    };

    window.WWebJS.processMediaData = async (
        mediaInfo,
        {
            forceSticker,
            forceGif,
            forceVoice,
            forceDocument,
            forceMediaHd,
            sendToChannel,
            sendToStatus,
            mediaPrepTimeoutMs = 60000,
            mediaUploadTimeoutMs = 120000,
        },
    ) => {
        const startedAt = Date.now();
        const opaqueDataTimeoutMs = Math.min(
            mediaPrepTimeoutMs || mediaUploadTimeoutMs || 60000,
            60000,
        );
        logDiagnostic('processMediaData.entry', {
            ...safeMediaSummary(mediaInfo),
            forceSticker,
            forceGif,
            forceVoice,
            forceDocument,
            sendToChannel,
            sendToStatus,
            mediaPrepTimeoutMs,
            mediaUploadTimeoutMs,
            opaqueDataTimeoutMs,
        });

        logDiagnostic('processMediaData.mediaInfoToFile.start', {
            ...safeMediaSummary(mediaInfo),
        });
        const file = window.WWebJS.mediaInfoToFile(mediaInfo);
        logDiagnostic('processMediaData.mediaInfoToFile.complete', {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            elapsedMs: Date.now() - startedAt,
        });

        logDiagnostic('processMediaData.opaqueData.require.start');
        const OpaqueData = window.require('WAWebMediaOpaqueData');
        logDiagnostic('processMediaData.opaqueData.require.complete', {
            hasCreateFromData: typeof OpaqueData?.createFromData === 'function',
            elapsedMs: Date.now() - startedAt,
        });

        logDiagnostic('processMediaData.opaqueData.create.start', {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            timeoutMs: opaqueDataTimeoutMs,
        });
        const opaqueData = await withTimeout(
            OpaqueData.createFromData(file, mediaInfo.mimetype),
            opaqueDataTimeoutMs,
            'processMediaData.opaqueData.createFromData',
        );
        logDiagnostic('processMediaData.opaqueData.create.complete', {
            elapsedMs: Date.now() - startedAt,
        });
        const mediaParams = {
            asSticker: forceSticker,
            asGif: forceGif,
            isPtt: forceVoice,
            asDocument: forceDocument,
        };
        logDiagnostic('processMediaData.start', {
            mimetype: mediaInfo.mimetype,
            filename: mediaInfo.filename,
            forceSticker,
            forceGif,
            forceVoice,
            forceDocument,
            sendToChannel,
            sendToStatus,
            mediaPrepTimeoutMs,
            mediaUploadTimeoutMs,
            elapsedMs: Date.now() - startedAt,
        });

        if (forceMediaHd && file.type.indexOf('image/') === 0) {
            mediaParams.maxDimension = 2560;
        }

        const mediaPrep = window
            .require('WAWebPrepRawMedia')
            .prepRawMedia(opaqueData, mediaParams);
        logDiagnostic('processMediaData.prep.start', {
            mediaParams,
            timeoutMs: mediaPrepTimeoutMs,
            elapsedMs: Date.now() - startedAt,
        });
        const mediaData = await withTimeout(
            mediaPrep.waitForPrep(),
            mediaPrepTimeoutMs,
            'processMediaData.waitForPrep',
        );
        logDiagnostic('processMediaData.prep.complete', {
            type: mediaData.type,
            mimetype: mediaData.mimetype,
            filehash: mediaData.filehash,
            size: mediaData.size,
            elapsedMs: Date.now() - startedAt,
        });
        const mediaObject = window
            .require('WAWebMediaStorage')
            .getOrCreateMediaObject(mediaData.filehash);
        const mediaType = window.require('WAWebMmsMediaTypes').msgToMediaType({
            type: mediaData.type,
            isGif: mediaData.isGif,
            isNewsletter: sendToChannel,
        });

        if (!mediaData.filehash) {
            throw new Error('media-fault: sendToChat filehash undefined');
        }

        if (
            (forceVoice && mediaData.type === 'ptt') ||
            (sendToStatus && mediaData.type === 'audio')
        ) {
            const waveform = mediaObject.contentInfo.waveform;
            mediaData.waveform =
                waveform || (await window.WWebJS.generateWaveform(file));
        }

        if (!(mediaData.mediaBlob instanceof OpaqueData)) {
            logDiagnostic('processMediaData.mediaBlob.rewrap.start', {
                blobType: mediaData.mediaBlob?.type || '',
                blobSize: mediaData.mediaBlob?.size || '',
                timeoutMs: opaqueDataTimeoutMs,
                elapsedMs: Date.now() - startedAt,
            });
            mediaData.mediaBlob = await withTimeout(
                OpaqueData.createFromData(
                    mediaData.mediaBlob,
                    mediaData.mediaBlob.type,
                ),
                opaqueDataTimeoutMs,
                'processMediaData.mediaBlob.createFromData',
            );
            logDiagnostic('processMediaData.mediaBlob.rewrap.complete', {
                elapsedMs: Date.now() - startedAt,
            });
        }

        mediaData.renderableUrl = mediaData.mediaBlob.url();
        mediaObject.consolidate(mediaData.toJSON());

        mediaData.mediaBlob.autorelease();
        const shouldUseMediaCache = window
            .require('WAWebMediaDataUtils')
            .shouldUseMediaCache(
                window.require('WAWebMmsMediaTypes').castToV4(mediaObject.type),
            );
        if (shouldUseMediaCache && mediaData.mediaBlob instanceof OpaqueData) {
            const formData = mediaData.mediaBlob.formData();
            window
                .require('WAWebMediaInMemoryBlobCache')
                .InMemoryMediaBlobCache.put(mediaObject.filehash, formData);
        }

        const dataToUpload = {
            mimetype: mediaData.mimetype,
            mediaObject,
            mediaType,
            ...(sendToChannel
                ? {
                      calculateToken: window.require('WAMediaCalculateFilehash')
                          .getRandomFilehash,
                  }
                : {}),
        };

        const { cancelUploadMedia, uploadMedia, uploadUnencryptedMedia } =
            window.require('WAWebMediaMmsV4Upload');
        logDiagnostic('processMediaData.upload.start', {
            mimetype: mediaData.mimetype,
            ...getMediaObjectSummary(mediaObject),
            mediaType,
            uploadTimeoutMs: mediaUploadTimeoutMs,
            uploadMethod: sendToChannel
                ? 'uploadUnencryptedMedia'
                : 'uploadMedia',
            uploadHosts: getMms4UploadHosts(),
        });
        const uploadPromise = !sendToChannel
            ? uploadMedia(dataToUpload)
            : uploadUnencryptedMedia(dataToUpload);
        logDiagnostic('processMediaData.upload.promiseCreated', {
            ...getMediaObjectSummary(mediaObject),
            elapsedMs: Date.now() - startedAt,
        });
        const uploadedMedia = await withUploadTimeout(
            uploadPromise,
            mediaUploadTimeoutMs,
            sendToChannel
                ? 'processMediaData.uploadUnencryptedMedia'
                : 'processMediaData.uploadMedia',
            () => {
                if (!sendToChannel && typeof cancelUploadMedia === 'function') {
                    cancelUploadMedia(mediaObject);
                }
            },
        );

        const mediaEntry = uploadedMedia.mediaEntry;
        if (!mediaEntry) {
            logDiagnostic('processMediaData.upload.noMediaEntry', {
                mimetype: mediaData.mimetype,
                ...getMediaObjectSummary(mediaObject),
            });
            throw new Error('upload failed: media entry was not created');
        }
        logDiagnostic('processMediaData.upload.complete', {
            mimetype: mediaData.mimetype,
            ...getMediaObjectSummary(mediaObject),
            hasMmsUrl: !!mediaEntry.mmsUrl,
            hasDeprecatedMms3Url: !!mediaEntry.deprecatedMms3Url,
            hasDirectPath: !!mediaEntry.directPath,
            hasUploadHash: !!mediaEntry.uploadHash,
            hasEncFilehash: !!mediaEntry.encFilehash,
            kind: uploadedMedia.kind || '',
            elapsedMs: Date.now() - startedAt,
        });

        mediaData.set({
            clientUrl: mediaEntry.mmsUrl,
            deprecatedMms3Url: mediaEntry.deprecatedMms3Url,
            directPath: mediaEntry.directPath,
            mediaKey: mediaEntry.mediaKey,
            mediaKeyTimestamp: mediaEntry.mediaKeyTimestamp,
            filehash: mediaObject.filehash,
            encFilehash: mediaEntry.encFilehash,
            uploadhash: mediaEntry.uploadHash,
            size: mediaObject.size,
            streamingSidecar: mediaEntry.sidecar,
            firstFrameSidecar: mediaEntry.firstFrameSidecar,
            mediaHandle: sendToChannel ? mediaEntry.handle : null,
        });

        return mediaData;
    };

    window.WWebJS.getMessageModel = (message) => {
        const msg = message.serialize();

        const { findLinks } = window.require('WALinkify');

        msg.isEphemeral = message.isEphemeral;
        msg.isStatusV3 = message.isStatusV3;
        msg.links = findLinks(
            message.mediaObject ? message.caption : message.body,
        ).map((link) => ({
            link: link.href,
            isSuspicious: Boolean(
                link.suspiciousCharacters && link.suspiciousCharacters.size,
            ),
        }));

        if (msg.buttons) {
            msg.buttons = msg.buttons.serialize();
        }
        if (msg.dynamicReplyButtons) {
            msg.dynamicReplyButtons = JSON.parse(
                JSON.stringify(msg.dynamicReplyButtons),
            );
        }
        if (msg.replyButtons) {
            msg.replyButtons = JSON.parse(JSON.stringify(msg.replyButtons));
        }

        if (typeof msg.id.remote === 'object') {
            msg.id = Object.assign({}, msg.id, {
                remote: getSerializedId(msg.id.remote),
            });
        }
        msg.id = normalizeId(msg.id);

        delete msg.pendingAckUpdate;

        return msg;
    };

    window.WWebJS.getChat = async (chatId, { getAsModel = true } = {}) => {
        try {
            const isChannel = /@\w*newsletter\b/.test(chatId);
            const chatWid = window.require('WAWebWidFactory').createWid(chatId);
            let chat;

            if (isChannel) {
                try {
                    chat = window
                        .require('WAWebCollections')
                        .WAWebNewsletterCollection.get(chatId);
                    if (!chat) {
                        await window
                            .require('WAWebLoadNewsletterPreviewChatAction')
                            .loadNewsletterPreviewChat(chatId);
                        chat = await window
                            .require('WAWebCollections')
                            .WAWebNewsletterCollection.find(chatWid);
                    }
                } catch (ignoredError) {
                    logDiagnostic('getChat.channel.error', { chatId });
                    chat = null;
                }
            } else {
                const Chat = window.require('WAWebCollections').Chat;
                const findChatBySerializedId = () =>
                    Chat.getModelsArray().find(
                        (candidate) => getSerializedId(candidate.id) === chatId,
                    );
                try {
                    chat =
                        Chat.get(chatWid) ||
                        findChatBySerializedId() ||
                        (
                            await window
                                .require('WAWebFindChatAction')
                                .findOrCreateLatestChat(chatWid)
                        )?.chat;
                } catch (ignoredError) {
                    logDiagnostic('getChat.findOrCreate.error', { chatId });
                    chat = findChatBySerializedId() || null;
                }
            }

            return getAsModel && chat
                ? await window.WWebJS.getChatModel(chat, {
                      isChannel: isChannel,
                  })
                : chat;
        } catch (ignoredError) {
            logDiagnostic('getChat.error', { chatId });
            return null;
        }
    };

    window.WWebJS.getChannelMetadata = async (inviteCode) => {
        const role = window
            .require('WAWebNewsletterModelUtils')
            .getRoleByIdentifier(inviteCode);
        const response = await window
            .require('WAWebNewsletterMetadataQueryJob')
            .queryNewsletterMetadataByInviteCode(inviteCode, role);

        const picUrl =
            response.newsletterPictureMetadataMixin?.picture[0]
                ?.queryPictureDirectPathOrEmptyResponseMixinGroup.value
                .directPath;

        return {
            id: response.idJid,
            createdAtTs:
                response.newsletterCreationTimeMetadataMixin.creationTimeValue,
            titleMetadata: {
                title: response.newsletterNameMetadataMixin.nameElementValue,
                updatedAtTs:
                    response.newsletterNameMetadataMixin.nameUpdateTime,
            },
            descriptionMetadata: {
                description:
                    response.newsletterDescriptionMetadataMixin
                        .descriptionQueryDescriptionResponseMixin.elementValue,
                updatedAtTs:
                    response.newsletterDescriptionMetadataMixin
                        .descriptionQueryDescriptionResponseMixin.updateTime,
            },
            inviteLink: `https://whatsapp.com/channel/${response.newsletterInviteLinkMetadataMixin.inviteCode}`,
            membershipType: role,
            stateType: response.newsletterStateMetadataMixin.stateType,
            pictureUrl: picUrl ? `https://pps.whatsapp.net${picUrl}` : null,
            subscribersCount:
                response.newsletterSubscribersMetadataMixin.subscribersCount,
            isVerified:
                response.newsletterVerificationMetadataMixin
                    .verificationState === 'verified',
        };
    };

    window.WWebJS.getChats = async () => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        const results = [];
        for (const chat of chats) {
            try {
                const model = await window.WWebJS.getChatModel(chat);
                if (model) results.push(model);
            } catch (ignoredError) {
                // Skip only the chat that fails due to WA Web IDB/LID changes.
            }
        }
        return results;
    };

    window.WWebJS.getChannels = async () => {
        const channels = window
            .require('WAWebCollections')
            .WAWebNewsletterCollection.getModelsArray();
        const results = [];
        for (const channel of channels || []) {
            try {
                const model = await window.WWebJS.getChatModel(channel, {
                    isChannel: true,
                });
                if (model) results.push(model);
            } catch (ignoredError) {
                // Keep the rest of the channel list usable when one model fails.
            }
        }
        return results;
    };

    window.WWebJS.getChatModel = async (chat, { isChannel = false } = {}) => {
        if (!chat) return null;

        const model = chat.serialize();
        model.isGroup = false;
        model.isMuted = chat.mute?.expiration !== 0;
        if (isChannel) {
            model.isChannel = window
                .require('WAWebChatGetters')
                .getIsNewsletter(chat);
        } else {
            model.formattedTitle = chat.formattedTitle;
        }

        if (chat.groupMetadata) {
            model.isGroup = true;
            const chatWid = window
                .require('WAWebWidFactory')
                .createWid(getSerializedId(chat.id));
            const groupMetadata =
                window.require('WAWebCollections').GroupMetadata ||
                window.require('WAWebCollections').WAWebGroupMetadataCollection;
            try {
                await groupMetadata.update(chatWid);
                const { toPn } = window.require('WAWebLidMigrationUtils');
                const serializedMetadata = chat.groupMetadata.serialize();
                for (const p of serializedMetadata.participants || []) {
                    p.id = toPn(p.id) ?? p.id;
                }
                model.groupMetadata = serializedMetadata;
                model.isReadOnly = chat.groupMetadata.announce;
            } catch (ignoredError) {
                logDiagnostic('getChatModel.groupMetadata.error', {
                    chatId: getSerializedId(chat.id),
                });
                model.groupMetadata = null;
                model.isReadOnly = false;
            }
        }

        if (chat.newsletterMetadata) {
            const newsletterMetadata =
                window.require('WAWebCollections')
                    .NewsletterMetadataCollection ||
                window.require('WAWebCollections')
                    .WAWebNewsletterMetadataCollection;
            await newsletterMetadata.update(chat.id);
            model.channelMetadata = chat.newsletterMetadata.serialize();
            model.channelMetadata.createdAtTs =
                chat.newsletterMetadata.creationTime;
        }

        model.lastMessage = null;
        if (model.msgs && model.msgs.length) {
            const lastMessage = chat.lastReceivedKey
                ? await window.WWebJS.getMsgById(
                      getSerializedId(chat.lastReceivedKey),
                  )
                : null;
            lastMessage &&
                (model.lastMessage =
                    window.WWebJS.getMessageModel(lastMessage));
        }

        delete model.msgs;
        delete model.msgUnsyncedButtonReplyMsgs;
        delete model.unsyncedButtonReplies;

        return model;
    };

    window.WWebJS.getContactModel = (contact) => {
        let res = contact.serialize();
        res.id = normalizeId(res.id);

        const wid = window
            .require('WAWebWidFactory')
            .createWidFromWidLike(contact.id);
        if (wid.isLid() && contact.phoneNumber) {
            res.id = contact.phoneNumber;
        }

        res.isBusiness =
            contact.isBusiness === undefined ? false : contact.isBusiness;

        if (contact.businessProfile) {
            res.businessProfile = contact.businessProfile.serialize();
        }

        res.isBlocked = contact.isContactBlocked;
        if (!res.isBlocked) {
            const alt = window
                .require('WAWebApiContact')
                .getAlternateUserWid(wid);
            if (alt) {
                res.isBlocked = !!window
                    .require('WAWebCollections')
                    .Blocklist.get(alt);
            }
        }

        const ContactMethods = window.require('WAWebContactGetters');
        res.isMe = ContactMethods.getIsMe(contact);
        res.isUser = ContactMethods.getIsUser(contact);
        res.isGroup = ContactMethods.getIsGroup(contact);
        res.isWAContact = ContactMethods.getIsWAContact(contact);
        res.userid = ContactMethods.getUserid(contact);
        res.verifiedName = ContactMethods.getVerifiedName(contact);
        res.verifiedLevel = ContactMethods.getVerifiedLevel(contact);
        res.statusMute = ContactMethods.getStatusMute(contact);
        res.name = ContactMethods.getName(contact);
        res.shortName = ContactMethods.getShortName(contact);
        res.pushname = ContactMethods.getPushname(contact);

        const { getIsMyContact } = window.require(
            'WAWebFrontendContactGetters',
        );
        res.isMyContact = getIsMyContact(contact);
        res.isEnterprise = ContactMethods.getIsEnterprise(contact);

        return res;
    };

    window.WWebJS.getContact = async (contactId) => {
        try {
            const contactWid = window
                .require('WAWebWidFactory')
                .createWid(contactId);
            const Contact = window.require('WAWebCollections').Contact;
            const contact =
                (await Contact.find(contactWid)) ||
                Contact.getModelsArray().find(
                    (candidate) => getSerializedId(candidate.id) === contactId,
                );
            if (!contact) return null;
            if (contact.isBusiness || contact.isEnterprise) {
                const bizProfile = await window
                    .require('WAWebCollections')
                    .BusinessProfile.find(contactWid);
                bizProfile.profileOptions &&
                    (contact.businessProfile = bizProfile);
            }
            return window.WWebJS.getContactModel(contact);
        } catch (ignoredError) {
            logDiagnostic('getContact.error', { contactId });
            return null;
        }
    };

    window.WWebJS.getContacts = () => {
        const contacts = window
            .require('WAWebCollections')
            .Contact.getModelsArray();
        return Promise.all(
            contacts.map(async (contact) => {
                if (contact.isBusiness || contact.isEnterprise) {
                    await window
                        .require('WAWebCollections')
                        .BusinessProfile.find(contact.id)
                        .catch(() => {});
                }
                return window.WWebJS.getContactModel(contact);
            }),
        );
    };

    window.WWebJS.mediaInfoToFile = ({ data, mimetype, filename }) => {
        const binaryData = window.atob(data);

        const buffer = new ArrayBuffer(binaryData.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < binaryData.length; i++) {
            view[i] = binaryData.charCodeAt(i);
        }

        const blob = new Blob([buffer], { type: mimetype });
        return new File([blob], filename, {
            type: mimetype,
            lastModified: Date.now(),
        });
    };

    /**
     * Resolves the media blob and metadata for a message.
     * Shared by downloadMedia and downloadMediaStream.
     * @param {string} msgId
     * @returns {Promise<{blob: Blob, mimetype: string, filename: string, filesize: number}|null>}
     */
    window.WWebJS.resolveMediaBlob = async (msgId) => {
        const msg = await window.WWebJS.getMsgById(msgId);

        if (
            !msg ||
            !msg.mediaData ||
            msg.mediaData.mediaStage === 'REUPLOADING'
        ) {
            logDiagnostic('resolveMediaBlob.unavailable', {
                msgId,
                hasMsg: !!msg,
                hasMediaData: !!msg?.mediaData,
                mediaStage: msg?.mediaData?.mediaStage,
            });
            return null;
        }

        // Always call internal downloadMedia - never skip based on
        // mediaStage, because cache eviction can leave stage=RESOLVED
        // with empty InMemoryMediaBlobCache.
        try {
            await withTimeout(
                msg.downloadMedia({
                    downloadEvenIfExpensive: true,
                    rmrReason: 1,
                    isUserInitiated: true,
                }),
                60000,
                'resolveMediaBlob.downloadMedia',
            );
        } catch (error) {
            logDiagnostic('resolveMediaBlob.downloadMedia.error', {
                msgId,
                name: error?.name,
                message: error?.message,
            });
            return null;
        }

        const mediaStage = String(msg.mediaData?.mediaStage || '');
        if (mediaStage.includes('ERROR') || mediaStage === 'FETCHING') {
            logDiagnostic('resolveMediaBlob.mediaStage.unavailable', {
                msgId,
                mediaStage,
            });
            return null;
        }

        const cached = window
            .require('WAWebMediaInMemoryBlobCache')
            .InMemoryMediaBlobCache.get(msg.mediaObject?.filehash);

        let blob;
        if (cached) {
            blob = cached;
        } else if (msg.mediaObject?.mediaBlob) {
            blob = msg.mediaObject.mediaBlob.forceToBlob();
        }

        if (!blob) {
            logDiagnostic('resolveMediaBlob.blob.notFound', {
                msgId,
                filehash: msg.mediaObject?.filehash,
                mediaStage,
            });
            return null;
        }

        return {
            blob,
            mimetype: msg.mimetype,
            filename: msg.filename,
            filesize: msg.size,
        };
    };

    window.WWebJS.arrayBufferToBase64 = (arrayBuffer) => {
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    };

    window.WWebJS.arrayBufferToBase64Async = (arrayBuffer) =>
        new Promise((resolve, reject) => {
            const blob = new Blob([arrayBuffer], {
                type: 'application/octet-stream',
            });
            const fileReader = new FileReader();
            fileReader.onload = () => {
                const [, data] = fileReader.result.split(',');
                resolve(data);
            };
            fileReader.onerror = (e) => reject(e);
            fileReader.readAsDataURL(blob);
        });

    window.WWebJS.getFileHash = async (data) => {
        let buffer = await data.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    };

    window.WWebJS.generateHash = async (length) => {
        var result = '';
        var characters =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for (var i = 0; i < length; i++) {
            result += characters.charAt(
                Math.floor(Math.random() * charactersLength),
            );
        }
        return result;
    };

    window.WWebJS.generateWaveform = async (audioFile) => {
        try {
            const audioData = await audioFile.arrayBuffer();
            const audioContext = new AudioContext();
            const audioBuffer = await audioContext.decodeAudioData(audioData);

            const rawData = audioBuffer.getChannelData(0);
            const samples = 64;
            const blockSize = Math.floor(rawData.length / samples);
            const filteredData = [];
            for (let i = 0; i < samples; i++) {
                const blockStart = blockSize * i;
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum = sum + Math.abs(rawData[blockStart + j]);
                }
                filteredData.push(sum / blockSize);
            }

            const multiplier = Math.pow(Math.max(...filteredData), -1);
            const normalizedData = filteredData.map((n) => n * multiplier);

            const waveform = new Uint8Array(
                normalizedData.map((n) => Math.floor(100 * n)),
            );

            return waveform;
        } catch (ignoredError) {
            return undefined;
        }
    };

    window.WWebJS.sendClearChat = async (chatId) => {
        let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        if (chat !== undefined) {
            await window.require('WAWebChatClearBridge').sendClear(chat, false);
            return true;
        }
        return false;
    };

    window.WWebJS.sendDeleteChat = async (chatId) => {
        let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        if (chat !== undefined) {
            await window.require('WAWebDeleteChatAction').sendDelete(chat);
            return true;
        }
        return false;
    };

    window.WWebJS.sendChatstate = async (state, chatId) => {
        chatId = window.require('WAWebWidFactory').createWid(chatId);

        const ChatState = window.require('WAWebChatStateBridge');
        switch (state) {
            case 'typing':
                await ChatState.sendChatStateComposing(chatId);
                break;
            case 'recording':
                await ChatState.sendChatStateRecording(chatId);
                break;
            case 'stop':
                await ChatState.sendChatStatePaused(chatId);
                break;
            default:
                throw 'Invalid chatstate';
        }

        return true;
    };

    window.WWebJS.getLabelModel = (label) => {
        let res = label.serialize();
        res.hexColor = label.hexColor;

        return res;
    };

    window.WWebJS.getLabels = () => {
        const labels = window
            .require('WAWebCollections')
            .Label.getModelsArray();
        return labels.map((label) => window.WWebJS.getLabelModel(label));
    };

    window.WWebJS.getLabel = (labelId) => {
        const label = window.require('WAWebCollections').Label.get(labelId);
        return window.WWebJS.getLabelModel(label);
    };

    window.WWebJS.getChatLabels = async (chatId) => {
        const chat = await window.WWebJS.getChat(chatId);
        return (chat.labels || []).map((id) => window.WWebJS.getLabel(id));
    };

    window.WWebJS.getOrderDetail = async (orderId, token, chatId) => {
        const chatWid = window.require('WAWebWidFactory').createWid(chatId);
        return window
            .require('WAWebBizOrderBridge')
            .queryOrder(chatWid, orderId, 80, 80, token);
    };

    window.WWebJS.getProductMetadata = async (productId) => {
        let sellerId = window.require('WAWebConnModel').Conn.wid;
        let product = await window
            .require('WAWebBizProductCatalogBridge')
            .queryProduct(sellerId, productId);
        if (product && product.data) {
            return product.data;
        }

        return undefined;
    };

    window.WWebJS.rejectCall = async (peerJid, id) => {
        let userId = window
            .require('WAWebUserPrefsMeUser')
            .getMaybeMePnUser()._serialized;

        const stanza = window.require('WAWap').wap(
            'call',
            {
                id: window.require('WAWap').generateId(),
                from: userId,
                to: peerJid,
            },
            [
                window.require('WAWap').wap('reject', {
                    'call-id': id,
                    'call-creator': peerJid,
                    count: '0',
                }),
            ],
        );
        await window.require('WADeprecatedSendIq').deprecatedCastStanza(stanza);
    };

    window.WWebJS.cropAndResizeImage = async (media, options = {}) => {
        if (!media.mimetype.includes('image'))
            throw new Error('Media is not an image');

        if (options.mimetype && !options.mimetype.includes('image'))
            delete options.mimetype;

        options = Object.assign(
            {
                size: 640,
                mimetype: media.mimetype,
                quality: 0.75,
                asDataUrl: false,
            },
            options,
        );

        const img = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = `data:${media.mimetype};base64,${media.data}`;
        });

        const sl = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - sl) / 2);
        const sy = Math.floor((img.height - sl) / 2);

        const canvas = document.createElement('canvas');
        canvas.width = options.size;
        canvas.height = options.size;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sl, sl, 0, 0, options.size, options.size);

        const dataUrl = canvas.toDataURL(options.mimetype, options.quality);

        if (options.asDataUrl) return dataUrl;

        return Object.assign(media, {
            mimetype: options.mimetype,
            data: dataUrl.replace(`data:${options.mimetype};base64,`, ''),
        });
    };

    window.WWebJS.setPicture = async (chatId, media) => {
        const thumbnail = await window.WWebJS.cropAndResizeImage(media, {
            asDataUrl: true,
            mimetype: 'image/jpeg',
            size: 96,
        });
        const profilePic = await window.WWebJS.cropAndResizeImage(media, {
            asDataUrl: true,
            mimetype: 'image/jpeg',
            size: 640,
        });

        const chatWid = window.require('WAWebWidFactory').createWid(chatId);
        try {
            const collection =
                window
                    .require('WAWebCollections')
                    .ProfilePicThumb.get(chatId) ||
                (await window
                    .require('WAWebCollections')
                    .ProfilePicThumb.find(chatId));
            if (!collection?.canSet()) return false;

            const res = await window
                .require('WAWebContactProfilePicThumbBridge')
                .sendSetPicture(chatWid, thumbnail, profilePic);
            return res ? res.status === 200 : false;
        } catch (err) {
            if (err.name === 'ServerStatusCodeError') return false;
            throw err;
        }
    };

    window.WWebJS.deletePicture = async (chatid) => {
        const chatWid = window.require('WAWebWidFactory').createWid(chatid);
        try {
            const collection = window
                .require('WAWebCollections')
                .ProfilePicThumb.get(chatid);
            if (!collection.canDelete()) return;

            const res = await window
                .require('WAWebContactProfilePicThumbBridge')
                .requestDeletePicture(chatWid);
            return res ? res.status === 200 : false;
        } catch (err) {
            if (err.name === 'ServerStatusCodeError') return false;
            throw err;
        }
    };

    window.WWebJS.getProfilePicThumbToBase64 = async (chatWid) => {
        const profilePicCollection = await window
            .require('WAWebCollections')
            .ProfilePicThumb.find(chatWid);

        const _readImageAsBase64 = (imageBlob) => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = function () {
                    const base64Image = reader.result;
                    if (base64Image == null) {
                        resolve(undefined);
                    } else {
                        const base64Data = base64Image.toString().split(',')[1];
                        resolve(base64Data);
                    }
                };
                reader.readAsDataURL(imageBlob);
            });
        };

        if (profilePicCollection?.img) {
            try {
                const response = await fetch(profilePicCollection.img);
                if (response.ok) {
                    const imageBlob = await response.blob();
                    if (imageBlob) {
                        const base64Image = await _readImageAsBase64(imageBlob);
                        return base64Image;
                    }
                }
            } catch (ignoredError) {
                /* empty */
            }
        }
        return undefined;
    };

    window.WWebJS.getAddParticipantsRpcResult = async (
        groupWid,
        participantWid,
    ) => {
        const iqTo = window.require('WAWebWidToJid').widToGroupJid(groupWid);

        const participantArgs = [
            {
                participantJid: window
                    .require('WAWebWidToJid')
                    .widToUserJid(participantWid),
            },
        ];

        let rpcResult, resultArgs;
        const data = {
            name: undefined,
            code: undefined,
            inviteV4Code: undefined,
            inviteV4CodeExp: undefined,
        };

        try {
            rpcResult = await window
                .require('WASmaxGroupsAddParticipantsRPC')
                .sendAddParticipantsRPC({ participantArgs, iqTo });
            resultArgs =
                rpcResult.value.addParticipant[0]
                    .addParticipantsParticipantAddedOrNonRegisteredWaUserParticipantErrorLidResponseMixinGroup
                    .value.addParticipantsParticipantMixins;
        } catch (ignoredError) {
            data.code = 400;
            return data;
        }

        if (rpcResult.name === 'AddParticipantsResponseSuccess') {
            const code = resultArgs?.value.error || '200';
            data.name = resultArgs?.name;
            data.code = +code;
            data.inviteV4Code = resultArgs?.value.addRequestCode;
            data.inviteV4CodeExp =
                resultArgs?.value.addRequestExpiration?.toString();
        } else if (rpcResult.name === 'AddParticipantsResponseClientError') {
            const { code: code } =
                rpcResult.value.errorAddParticipantsClientErrors.value;
            data.code = +code;
        } else if (rpcResult.name === 'AddParticipantsResponseServerError') {
            const { code: code } = rpcResult.value.errorServerErrors.value;
            data.code = +code;
        }

        return data;
    };

    window.WWebJS.membershipRequestAction = async (
        groupId,
        action,
        requesterIds,
        sleep,
    ) => {
        const groupWid = window.require('WAWebWidFactory').createWid(groupId);
        const group = await window
            .require('WAWebCollections')
            .Chat.find(groupWid);
        const toApprove = action === 'Approve';
        let membershipRequests;
        let response;
        let result = [];

        await window
            .require('WAWebGroupQueryJob')
            .queryAndUpdateGroupMetadataById({ id: groupId });

        if (!requesterIds?.length) {
            membershipRequests =
                group.groupMetadata.membershipApprovalRequests._models.map(
                    ({ id }) => id,
                );
        } else {
            !Array.isArray(requesterIds) && (requesterIds = [requesterIds]);
            membershipRequests = requesterIds.map((r) =>
                window.require('WAWebWidFactory').createWid(r),
            );
        }

        if (!membershipRequests.length) return [];

        const participantArgs = membershipRequests.map((m) => ({
            participantArgs: [
                {
                    participantJid: window
                        .require('WAWebWidToJid')
                        .widToUserJid(m),
                },
            ],
        }));

        const groupJid = window
            .require('WAWebWidToJid')
            .widToGroupJid(groupWid);

        const _getSleepTime = (sleep) => {
            if (
                !Array.isArray(sleep) ||
                (sleep.length === 2 && sleep[0] === sleep[1])
            ) {
                return sleep;
            }
            if (sleep.length === 1) {
                return sleep[0];
            }
            sleep[1] - sleep[0] < 100 &&
                (sleep[0] = sleep[1]) &&
                (sleep[1] += 100);
            return (
                Math.floor(Math.random() * (sleep[1] - sleep[0] + 1)) + sleep[0]
            );
        };

        const membReqResCodes = {
            default: `An unknown error occupied while ${toApprove ? 'approving' : 'rejecting'} the participant membership request`,
            400: 'ParticipantNotFoundError',
            401: 'ParticipantNotAuthorizedError',
            403: 'ParticipantForbiddenError',
            404: 'ParticipantRequestNotFoundError',
            408: 'ParticipantTemporarilyBlockedError',
            409: 'ParticipantConflictError',
            412: 'ParticipantParentLinkedGroupsResourceConstraintError',
            500: 'ParticipantResourceConstraintError',
        };

        try {
            for (const participant of participantArgs) {
                response = await window
                    .require('WASmaxGroupsMembershipRequestsActionRPC')
                    .sendMembershipRequestsActionRPC({
                        iqTo: groupJid,
                        [toApprove ? 'approveArgs' : 'rejectArgs']: participant,
                    });

                if (
                    response.name === 'MembershipRequestsActionResponseSuccess'
                ) {
                    const value = toApprove
                        ? response.value.membershipRequestsActionApprove
                        : response.value.membershipRequestsActionReject;
                    if (value?.participant) {
                        const [_] = value.participant.map((p) => {
                            const error = toApprove
                                ? value.participant[0]
                                      .membershipRequestsActionAcceptParticipantMixins
                                      ?.value.error
                                : value.participant[0]
                                      .membershipRequestsActionRejectParticipantMixins
                                      ?.value.error;
                            return {
                                requesterId: window
                                    .require('WAWebWidFactory')
                                    .createWid(p.jid)._serialized,
                                ...(error
                                    ? {
                                          error: +error,
                                          message:
                                              membReqResCodes[error] ||
                                              membReqResCodes.default,
                                      }
                                    : {
                                          message: `${toApprove ? 'Approved' : 'Rejected'} successfully`,
                                      }),
                            };
                        });
                        _ && result.push(_);
                    }
                } else {
                    result.push({
                        requesterId: window
                            .require('WAWebJidToWid')
                            .userJidToUserWid(
                                participant.participantArgs[0].participantJid,
                            )._serialized,
                        message: 'ServerStatusCodeError',
                    });
                }

                sleep &&
                    participantArgs.length > 1 &&
                    participantArgs.indexOf(participant) !==
                        participantArgs.length - 1 &&
                    (await new Promise((resolve) =>
                        setTimeout(resolve, _getSleepTime(sleep)),
                    ));
            }
            return result;
        } catch (ignoredError) {
            return [];
        }
    };

    window.WWebJS.subscribeToUnsubscribeFromChannel = async (
        channelId,
        action,
        options = {},
    ) => {
        const channel = await window.WWebJS.getChat(channelId, {
            getAsModel: false,
        });

        if (!channel || channel.newsletterMetadata.membershipType === 'owner')
            return false;
        options = {
            eventSurface: 3,
            deleteLocalModels: options.deleteLocalModels ?? true,
        };

        try {
            if (action === 'Subscribe') {
                await window
                    .require('WAWebNewsletterSubscribeAction')
                    .subscribeToNewsletterAction(channel, options);
            } else if (action === 'Unsubscribe') {
                await window
                    .require('WAWebNewsletterUnsubscribeAction')
                    .unsubscribeFromNewsletterAction(channel, options);
            } else return false;
            return true;
        } catch (err) {
            if (err.name === 'ServerStatusCodeError') return false;
            throw err;
        }
    };

    window.WWebJS.pinUnpinMsgAction = async (msgId, action, duration) => {
        const message = await window.WWebJS.getMsgById(msgId);
        if (!message) return false;

        if (typeof duration !== 'number') return false;

        const originalFunction = window.require(
            'WAWebPinMsgConstants',
        ).getPinExpiryDuration;
        window.require('WAWebPinMsgConstants').getPinExpiryDuration = () =>
            duration;

        const response = await window
            .require('WAWebSendPinMessageAction')
            .sendPinInChatMsg(message, action, duration);

        window.require('WAWebPinMsgConstants').getPinExpiryDuration =
            originalFunction;

        return response.messageSendResult === 'OK';
    };

    window.WWebJS.getStatusModel = (status) => {
        const res = status.serialize();
        delete res._msgs;
        return res;
    };

    window.WWebJS.getAllStatuses = () => {
        const statuses = window
            .require('WAWebCollections')
            .Status.getModelsArray();
        return statuses.map((status) => window.WWebJS.getStatusModel(status));
    };

    window.WWebJS.enforceLidAndPnRetrieval = async (userId) => {
        const wid = window.require('WAWebWidFactory').createWid(userId);
        const isLid = wid.server === 'lid';

        let lid = isLid
            ? wid
            : window.require('WAWebApiContact').getCurrentLid(wid);
        let phone = isLid
            ? window.require('WAWebApiContact').getPhoneNumber(wid)
            : wid;

        if (!isLid && !lid) {
            const queryResult = await window
                .require('WAWebQueryExistsJob')
                .queryWidExists(wid);
            if (!queryResult?.wid) return {};
            lid = window.require('WAWebApiContact').getCurrentLid(wid);
        }

        if (isLid && !phone) {
            const queryResult = await window
                .require('WAWebQueryExistsJob')
                .queryWidExists(wid);
            if (!queryResult?.wid) return {};
            phone = window.require('WAWebApiContact').getPhoneNumber(wid);
        }

        return { lid, phone };
    };

    window.WWebJS.assertColor = (hex) => {
        let color;
        if (typeof hex === 'number') {
            color = hex > 0 ? hex : 0xffffffff + parseInt(hex) + 1;
        } else if (typeof hex === 'string') {
            let number = hex.trim().replace('#', '');
            if (number.length <= 6) {
                number = 'FF' + number.padStart(6, '0');
            }
            color = parseInt(number, 16);
        } else {
            throw 'Invalid hex color';
        }
        return color;
    };
};
