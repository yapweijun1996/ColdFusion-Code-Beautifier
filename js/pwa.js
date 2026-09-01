/* PWA registration and user-controlled update flow.
 *
 * The browser detects a new service worker by comparing sw.js. A release must
 * therefore change CACHE_VERSION in sw.js (see the release notes) whenever
 * application source changes. The new worker is installed in the background,
 * but it stays waiting until the user chooses "Update now".
 */
(function (root) {
	'use strict';

	var DRAFT_KEY = 'cfb.pwa.draft.input';
	var state = {
		registration: null,
		initialized: false,
		hasController: false,
		updateRequested: false,
		reloading: false,
		promptShown: false,
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
		if (!storage) return;
		try { storage.removeItem(DRAFT_KEY); } catch (e) {}
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
		if (!storage || !input || typeof input.value !== 'string') return;

		var draft;
		try { draft = storage.getItem(DRAFT_KEY); } catch (e) { return; }
		if (draft === null) return;

		/* Never overwrite a value restored by the browser or supplied by an
		 * embedding page. The saved draft is single-use either way. */
		if (input.value !== '') {
			removeDraft();
			return;
		}
		input.value = draft;
		removeDraft();
		dispatchInputEvent(input);
	}

	function saveDraft() {
		var input = getElement('input');
		if (!input || typeof input.value !== 'string' || input.value === '') {
			removeDraft();
			return true;
		}
		var storage = getStorage();
		if (!storage) return false;
		try {
			storage.setItem(DRAFT_KEY, input.value);
			return true;
		} catch (e) {
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
		if (!state.updateToast) return;
		if (typeof state.updateToast.remove === 'function') state.updateToast.remove();
		state.updateToast = null;
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

	function reloadFromPrompt() {
		if (!saveDraft()) {
			notify('Update postponed because your input could not be saved.');
			state.reloading = false;
			return;
		}
		reloadPage();
	}

	function requestUpdate(registration, worker) {
		if (state.updateRequested) return;
		if (!saveDraft()) {
			notify('Update postponed because your input could not be saved.');
			state.promptShown = false;
			return;
		}

		state.updateRequested = true;
		var waiting = (registration && registration.waiting) || worker;
		if (!waiting || typeof waiting.postMessage !== 'function') {
			removeDraft();
			state.updateRequested = false;
			state.promptShown = false;
			notify('The update is no longer available. Please try again.');
			return;
		}
		try {
			waiting.postMessage({ type: 'SKIP_WAITING' });
		} catch (e) {
			removeDraft();
			state.updateRequested = false;
			state.promptShown = false;
			notify('The update could not be started. Please try again.');
		}
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
		state.updateToast = action(
			'A new version is ready.',
			'Update now',
			function () { requestUpdate(registration, worker); },
			{ duration: 0 }
		);
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
		state.updateToast = action(
			'A new version is active.',
			'Reload now',
			reloadFromPrompt,
			{ duration: 0 }
		);
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
				reloadPage();
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
		win.addEventListener('beforeunload', function () {
			/* If activation is slow and the user closes/reloads manually after
			 * consenting, refresh the snapshot so a later restore is not stale. */
			if (state.updateRequested) saveDraft();
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
