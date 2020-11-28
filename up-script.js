// upgrade script skeleton
if (process.env.DEVELOPER) {
	config._configIdx = -1;
}	

this.addUpgradeScript( 
/** 
* Upgrade script to convert any old configs, actions, feedbacks
* that may have changed due to module additions and modifications		*
* @param {Object} config - 			currently saved paramaters 
* @param {Array} actions - 			(down) actions defined on current buttons
* @param {Array} releaseActions - 	(up) actions defined on current buttons
* @param {Array} feedbacks	-		feedbacks in use on current buttons
* @returns {Boolean} 				true if any items were changed
* @since 1.0.0
*
*/
	(config, actions, releaseActions, feedbacks) => {
				
	let changed = false;

	const upgradePass = (actions) => {
		let changed = false;
		for (let action of actions) {
			
			// example
			if ('mute_grp' == action.action) {
				if (action.options.mute === null) {
					action.options.mute = '1';
					changed = true;
				}
			}
		}
		return changed;
	}

	// feedback example
	const upgradeFeedbacks = (feedbacks) => {
		let changed = false;

		for (let feedback of feedbacks) {
			// anything to change?
		}
		return changed;
	}

	// config example
	if (config.host !== undefined) {
		config.old_host = config.host;
		changed = true;
	}

	changed = upgradePass(actions) || changed;
	changed = upgradePass(releaseActions) || changed;

	changed = upgradeFeedbacks(feedbacks) || changed;

	return changed;
});
