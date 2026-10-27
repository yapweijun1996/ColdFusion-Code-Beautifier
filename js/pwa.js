/* PWA registration and user-controlled update flow.
 *
 * The browser detects a new service worker by comparing sw.js. The deployment
 * stamps CACHE_VERSION from the source commit, so every source release has a
 * byte-different worker. The new worker is installed in the background,
 * but it stays waiting until the user chooses "Update now".
 */
(function (root) {
	'use strict';

	var DRAFT_KEY = 'cfb.pwa.draft.state';
	// One-time migration of input-only drafts saved by older deployed pages.
	var LEGACY_DRAFT_KEY = 'cfb.pwa.draft.input';
	var state = {
		registration: null,
		initialized: false,
		hasController: false,
		updateRequested: false,
		reloading: false,
		promptShown: false,
		promptToken: null,
		updateToast: null,
		watchedWorker: null
	};

	function getDocument() {
		return typeof document !== 'undefined' ? document : null;
	}

	function getNavigator() {
		return typeof navigator !== 'undefined' ? navigator : null;
	}

	function getElement(id) {
		var doc = getDocument();
		return doc && typeof doc.getElementById === 'function' ? doc.getElementById(id) : null;
	}

	function getFunction(name) {
		if (root && typeof root[name] === 'function') return root[name];
		try {
			if (typeof window !== 'undefined' && typeof window[name] === 'function') return window[name];
		} catch (e) {}
		return null;
	}

	function getStorage() {
		try {
			if (root && root.sessionStorage) return root.sessionStorage;
			if (typeof sessionStorage !== 'undefined') return sessionStorage;
		} catch (e) {}
		return null;
	}

	function removeDraft() {
		var storage = getStorage();
		if (!storage) return false;
		try {
			storage.removeItem(DRAFT_KEY);
			storage.removeItem(LEGACY_DRAFT_KEY);
			return true;
		} catch (e) {
			return false;
		}
	}

	function dispatchInputEvent(input) {
		if (!input || typeof input.dispatchEvent !== 'function') return;
		try {
			var event = null;
			var EventCtor = root && root.Event;
			if (typeof EventCtor === 'function') {
				event = new EventCtor('input', { bubbles: true });
			} else {
				var doc = getDocument();
				if (doc && typeof doc.createEvent === 'function') {
					event = doc.createEvent('Event');
					event.initEvent('input', true, false);
				}
			}
			if (event) input.dispatchEvent(event);
		} catch (e) {
			/* Restoring the value is the important part; event dispatch is an
			 * enhancement for integrations that observe editor changes. */
		}
	}

	function restoreDraft() {
		var storage = getStorage();
		var input = getElement('input');
		var output = getElement('output');
		if (!storage) return;

		var saved, snapshot;
		try {
			saved = storage.getItem(DRAFT_KEY);
			if (saved !== null) {
				snapshot = JSON.parse(saved);
				if (!snapshot || typeof snapshot.input !== 'string' || typeof snapshot.output !== 'string') return;
			} else {
				saved = storage.getItem(LEGACY_DRAFT_KEY);
				if (saved === null) return;
				snapshot = { input: saved, output: '' };
			}
		} catch (e) { return; }

		// Browser-restored or embedded values take precedence independently.
		if (input && input.value === '' && snapshot.input !== '') {
			input.value = snapshot.input;
			dispatchInputEvent(input);
		}
		if (output && output.value === '' && snapshot.output !== '') {
			output.value = snapshot.output;
			dispatchInputEvent(output);
		}
		removeDraft();
	}

	function saveDraft() {
		var input = getElement('input');
		var output = getElement('output');
		var inputValue = input && typeof input.value === 'string' ? input.value : '';
		var outputValue = output && typeof output.value === 'string' ? output.value : '';
		var storage = getStorage();
		if (!inputValue && !outputValue) return storage ? removeDraft() : true;
		if (!storage) return false;
		try {
			// One write makes input and output a single coherent snapshot.
			storage.setItem(DRAFT_KEY, JSON.stringify({ input: inputValue, output: outputValue }));
			storage.removeItem(LEGACY_DRAFT_KEY);
			return true;
		} catch (e) {
			// Never silently restore an older snapshot after a failed save.
			removeDraft();
			return false;
		}
	}

	function notify(message) {
		var toast = getFunction('simple_toast_msg');
		if (toast) {
			try { toast(message); } catch (e) {}
		}
	}

	function closeUpdateToast() {
		state.promptToken = null;
		if (!state.updateToast) return;
		if (typeof state.updateToast.remove === 'function') state.updateToast.remove();
		state.updateToast = null;
	}

	function normalizeVersion(value, fallback) {
		value = String(value || '').trim();
		if (!value || value === '__BUILD_VERSION__' || value === 'dev') return fallback;
		value = value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
		return value || fallback;
	}

	function currentVersion() {
		var versionEl = getElement('app-version');
		if (!versionEl) return 'current';
		var value = versionEl.textContent;
		if (!value && typeof versionEl.getAttribute === 'function') {
			value = versionEl.getAttribute('data-build-version');
		}
		return normalizeVersion(value, 'current');
	}

	function getWorkerVersion(worker, callback) {
		var Channel = root && root.MessageChannel;
		if (typeof Channel !== 'function' || !worker || typeof worker.postMessage !== 'function') {
			callback('');
			return;
		}

		var finished = false;
		var channel;
		var timer = null;
		function finish(version) {
			if (finished) return;
			finished = true;
			if (timer && typeof clearTimeout === 'function') clearTimeout(timer);
			if (channel && channel.port1) channel.port1.onmessage = null;
			callback(normalizeVersion(version, ''));
		}
		try {
			channel = new Channel();
			channel.port1.onmessage = function (event) {
				var data = event && event.data;
				finish(data && data.type === 'VERSION' ? data.version : '');
			};
			worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
			if (typeof setTimeout === 'function') {
				timer = setTimeout(function () { finish(''); }, 750);
			}
		} catch (e) {
			finish('');
		}
	}

	function versionMessage(prefix, newVersion) {
		newVersion = normalizeVersion(newVersion, '');
		if (newVersion) return prefix + ' (' + currentVersion() + ' → ' + newVersion + ').';
		return prefix + '.';
	}

	function reloadPage() {
		if (state.reloading) return;
		state.reloading = true;
		var locationObject = root && root.location;
		if (!locationObject && typeof location !== 'undefined') locationObject = location;
		if (locationObject && typeof locationObject.reload === 'function') {
			locationObject.reload();
		}
	}

	function prepareReload() {
		if (root && root.CFBEditorUI && typeof root.CFBEditorUI.isBusy === 'function'
				&& root.CFBEditorUI.isBusy()) {
			notify('Update postponed until formatting finishes.');
			return false;
		}
		if (!saveDraft()) {
			notify('Update postponed because your input and output could not be saved.');
			return false;
		}
		return true;
	}

	function reloadFromPrompt() {
		if (!prepareReload()) return false;
		reloadPage();
		return true;
	}

	function requestUpdate(registration, worker) {
		if (state.updateRequested || !prepareReload()) return false;

		state.updateRequested = true;
		var waiting = (registration && registration.waiting) || worker;
		if (!waiting || typeof waiting.postMessage !== 'function') {
			removeDraft();
			state.updateRequested = false;
			notify('The update is no longer available. Please try again.');
			return false;
		}
		try {
			waiting.postMessage({ type: 'SKIP_WAITING' });
		} catch (e) {
			removeDraft();
			state.updateRequested = false;
			notify('The update could not be started. Please try again.');
			return false;
		}
		return true;
	}

	function showUpdatePrompt(registration, worker) {
		var serviceWorker = getNavigator() && getNavigator().serviceWorker;
		if (!serviceWorker || !serviceWorker.controller || state.promptShown || state.updateRequested) return;
		var action = getFunction('simple_toast_action');
		if (typeof action !== 'function') {
			notify('A new version is available. Refresh this page to update.');
			state.promptShown = true;
			return;
		}

		state.promptShown = true;
		var token = {};
		state.promptToken = token;
		getWorkerVersion(worker, function (newVersion) {
			if (state.promptToken !== token || state.updateRequested) return;
			state.updateToast = action(
				versionMessage('A new version is ready', newVersion),
				'Update now',
				function () { return requestUpdate(registration, worker); },
				{ duration: 0 }
			);
		});
	}

	function showReloadPrompt() {
		if (state.promptShown || state.updateRequested) return;
		var action = getFunction('simple_toast_action');
		if (typeof action !== 'function') {
			notify('A new version is active. Refresh this page to update.');
			state.promptShown = true;
			return;
		}
		state.promptShown = true;
		var token = {};
		state.promptToken = token;
		var serviceWorker = getNavigator() && getNavigator().serviceWorker;
		getWorkerVersion(serviceWorker && serviceWorker.controller, function (newVersion) {
			if (state.promptToken !== token || state.updateRequested) return;
			state.updateToast = action(
				versionMessage('A new version is active', newVersion),
				'Reload now',
				reloadFromPrompt,
				{ duration: 0 }
			);
		});
	}

	function watchInstalling(registration) {
		var worker = registration && registration.installing;
		if (!worker || worker === state.watchedWorker) return;
		state.watchedWorker = worker;
		var onStateChange = function () {
			if (worker.state === 'installed' && getNavigator().serviceWorker.controller) {
				showUpdatePrompt(registration, worker);
			}
		};
		if (typeof worker.addEventListener === 'function') worker.addEventListener('statechange', onStateChange);
		/* The worker may already have reached installed before the listener was
		 * attached, so handle that race explicitly. */
		onStateChange();
	}

	function promptIfWaiting(registration) {
		if (registration && registration.waiting && getNavigator().serviceWorker.controller) {
			showUpdatePrompt(registration, registration.waiting);
		}
	}

	function checkForUpdate(registration) {
		var result = registration.update();
		if (result && typeof result.then === 'function') {
			return result.then(function (value) {
				watchInstalling(registration);
				promptIfWaiting(registration);
				return value;
			});
		}
		watchInstalling(registration);
		promptIfWaiting(registration);
		return result;
	}

	function init() {
		if (state.initialized) return;
		state.initialized = true;
		restoreDraft();

		var serviceWorker = getNavigator() && getNavigator().serviceWorker;
		var locationObject = root && root.location;
		if (!locationObject && typeof location !== 'undefined') locationObject = location;
		if (!serviceWorker || (locationObject && locationObject.protocol === 'file:')) return;

		state.hasController = !!serviceWorker.controller;
		serviceWorker.addEventListener('controllerchange', function () {
			if (state.updateRequested) {
				// Input or output can change while the new worker activates.
				state.updateRequested = false;
				state.hasController = true;
				if (prepareReload()) {
					reloadPage();
				} else {
					closeUpdateToast();
					state.promptShown = false;
					showReloadPrompt();
				}
				return;
			}
			if (state.hasController) {
				/* Another tab may have accepted the update. Do not reload this tab
				 * without consent; offer a safe reload instead. */
				closeUpdateToast();
				state.promptShown = false;
				showReloadPrompt();
			}
			state.hasController = true;
		});

		var win = root || (typeof window !== 'undefined' ? window : null);
		if (!win || typeof win.addEventListener !== 'function') return;
		win.addEventListener('beforeunload', function (event) {
			if ((state.updateRequested || state.reloading) && !prepareReload()) {
				// Browsers may still leave if the user confirms the native prompt.
				// A pending formatter may still change the visible fields.
				removeDraft();
				state.reloading = false;
				if (!state.updateRequested) {
					closeUpdateToast();
					state.promptShown = false;
					showReloadPrompt();
				}
				if (event && typeof event.preventDefault === 'function') event.preventDefault();
				if (event) event.returnValue = '';
			}
		});
		win.addEventListener('load', function () {
			serviceWorker.register('./sw.js').then(function (registration) {
				state.registration = registration;

				/* Attach listeners before update() so an installing worker cannot
				 * cross the installed boundary between these operations. */
				if (typeof registration.addEventListener === 'function') {
					registration.addEventListener('updatefound', function () {
						watchInstalling(registration);
					});
				}
				watchInstalling(registration);
				promptIfWaiting(registration);

				checkForUpdate(registration).catch(function () {});
				win.checkForUpdate = function () { return checkForUpdate(registration); };
				if (typeof setInterval === 'function') {
					setInterval(function () {
						if (getDocument() && getDocument().visibilityState === 'visible') {
							checkForUpdate(registration).catch(function () {});
						}
					}, 60 * 60 * 1000);
				}
				if (getDocument() && typeof getDocument().addEventListener === 'function') {
					getDocument().addEventListener('visibilitychange', function () {
						if (getDocument().visibilityState === 'visible') checkForUpdate(registration).catch(function () {});
					});
				}
			}).catch(function (err) {
				if (typeof console !== 'undefined' && console.warn) {
					console.warn('[pwa] SW registration failed:', err);
				}
			});
		});
	}

	if (root) {
		root.CFBPWA = {
			draftKey: DRAFT_KEY,
			restoreDraft: restoreDraft,
			saveDraft: saveDraft,
			requestUpdate: requestUpdate
		};
	}
	init();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
