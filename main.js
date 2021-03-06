const listeners = {
	"modifyDocument": response => {
		Scenes._resetFog(response);
		const { request } = response;
		const isEmbedded = CONST.DOCUMENT_TYPES.includes(request.parentType);
		switch (request.action) {
			case "create":
				if (isEmbedded) return CONFIG.DatabaseBackend._handleCreateEmbeddedDocuments(response);
				else return CONFIG.DatabaseBackend._handleCreateDocuments(response);
			case "update":
				if (isEmbedded) return CONFIG.DatabaseBackend._handleUpdateEmbeddedDocuments(response);
				else return CONFIG.DatabaseBackend._handleUpdateDocuments(response);
			case "delete":
				if (isEmbedded) return CONFIG.DatabaseBackend._handleDeleteEmbeddedDocuments(response);
				else return CONFIG.DatabaseBackend._handleDeleteDocuments(response);
			default:
				throw new Error(`Invalid Document modification action ${request.action} provided`);
		}
	},
	"disconnect": () => {
		ui.notifications.error("You have lost connection to the server, attempting to re-establish.");
	},
	"reconnect_failed": () => {
		ui.notifications.error("Server connection lost.");
		window.location.href = foundry.utils.getRoute("no");
	},
	"reconnect": () => {
		ui.notifications.info("Server connection re-established.");
	},
	"pause": pause => {
		game.togglePause(pause, false);
	},
	"shutdown": () => {
		ui.notifications.info("The game world is shutting down and you will be returned to the server homepage.", {
			permanent: true
		});
		setTimeout(() => window.location.href = foundry.utils.getRoute("/"), 1000);
	},
	"playAudio": AudioHelper.play,
	"preloadAudio": AudioHelper.preloadSound,
	"userActivity": Users._handleUserActivity,
	"preloadScene": sceneId => Scenes.instance.preload(sceneId),
	"pullToScene": Scenes._pullToScene,
	"showEntry": Journal._showEntry,
	"shareImage": ImagePopout._handleShareImage,
	"resetFog": FogExploration._onResetFog,
};

const collectedMessages = [];

function hookFunctions() {
	Game.getData = gameGetData;
	Game.prototype.setupGame = setupGame;
}

async function gameGetData(socket) {
	return new Promise(resolve => {
		socket.emit("world", (world) => {
			activateCollectingSocketListeners();
			resolve(world);
		});
	});
}

async function setupGame() {
	Hooks.callAll('setup');

	// Store permission settings
	this.permissions = await this.settings.get("core", "permissions");

	// Data initialization
	this.initializePacks();     // Do this first since entities may reference compendium content
	this.initializeDocuments();  // Next initialize world-level documents
	this.initializeRTC();       // Intentionally async

	// Interface initialization
	this.initializeMouse();
	this.initializeGamepads();
	this.initializeKeyboard();
	this.initializeUI();
	DocumentSheetConfig.initializeSheets();

	// Canvas initialization
	await this.initializeCanvas();
	await catchUp();
	this.activateSocketListeners();

	// If the player is not a GM and does not have an impersonated character, prompt for selection
	if (!this.user.isGM && !this.user.character) {
		new UserConfig(this.user).render(true);
	}

	// Call all game ready hooks
	this.ready = true;

	// Initialize New User Experience
	this.nue.initialize();

	/**
	 * A hook event that fires when the game is fully ready.
	 * @function ready
	 * @memberof hookEvents
	 */
	Hooks.callAll("ready");
}

function activateCollectingSocketListeners() {
	for (const name of Object.keys(listeners)) {
		socket.on(name, (message) => collectMessage(name, message))
	}
}

function deactivateCollectingSocketListeners() {
	for (const name of Object.keys(listeners)) {
		socket.removeAllListeners(name);
	}
}

function collectMessage(type, message) {
	collectedMessages.push([type, message]);
}

async function catchUp() {
	while (collectedMessages.length > 0) {
		const [type, message] = collectedMessages.shift();
		await listeners[type](message);
		// If no scene is currently loading this will return immediately.
		await waitForSceneLoad();

		// Some actions (for example moving tokens) don't execute porperly if performed in rapid successeion
		// Sleep a little to hopefully avoid this issue
		// userActivity and pause are known to be unproblematic.
		// userActivity fires often enough to make the process extremely sluggish, so we don't wait after those events
		if (type !== "userActivity" && type !== "pause")
			await sleep(100);
	}
	deactivateCollectingSocketListeners();
}

async function sleep(time) {
	return new Promise(resolve => window.setTimeout(resolve, time));
}

async function waitForSceneLoad() {
	while (canvas.loading) {
		await sleep(100);
	}
}

hookFunctions();
