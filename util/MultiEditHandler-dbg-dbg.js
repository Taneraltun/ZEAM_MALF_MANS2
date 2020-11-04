/*
 * Copyright (C) 2009-2019 SAP SE or an SAP affiliate company. All rights reserved.
 */
sap.ui.define([
	"sap/ui/base/Object"
], function(BaseObject) {
	"use strict";
	return BaseObject.extend("i2d.eam.order.manages1.util.MultiEditHandler", {

		_aFields: null,
		_oModel: null,
		_sDialogFragment: null,
		_sActionName: null,

		constructor: function(oModel, sActionName, sDialogFragment) {
			this._oModel = oModel;
			this._sActionName = sActionName;
			this._sDialogFragment = sDialogFragment;

			var oMetaModel = this._oModel.getMetaModel();
			this._aFields = oMetaModel.getODataFunctionImport("EAM_OBJPG_MAINTENANCEORDER_SRV.EAM_OBJPG_MAINTENANCEORDER_SRV_Entities/" + this._sActionName)
				.parameter.map(function(mParameter) {
					return mParameter.name;
				});
		},

		showDialog: function(oParentView, aContextsForEdit) {
			var that = this,
				oExtensionAPI = oParentView.getController().extensionAPI;

			var aFieldsToRetrieve = this._aFields.filter(function(sField) {
					// all selected contexts need to have this field, otherwise we will have to fetch data from backend before the dialog opens
					return aContextsForEdit.filter(function(oSelectedContext) {
						return typeof oSelectedContext.getProperty(sField) === "undefined";
					}).length > 0;
				}),
				prepareDialog;

			if (aFieldsToRetrieve.length) {
				prepareDialog = Promise.all(aContextsForEdit.map(function(oSelectedContext) {
					return new Promise(function(resolve, reject) {
						that._oModel.read(oSelectedContext.getPath(), {
							urlParameters: {
								$select: aFieldsToRetrieve.join()
							},
							success: resolve,
							error: reject
						});
					});
				}));
			} else {
				prepareDialog = Promise.resolve();
			}

			prepareDialog.then(function() {
				var oMultiEditContainer, oDialog = sap.ui.xmlfragment(oParentView.getController().createId("MultiEditDialog"),
					that._sDialogFragment, jQuery.extend({}, this, {
						afterDialogClosed: function() {
							oParentView.removeDependent(oDialog);
							oDialog.destroy();
						},
						onOkPressed: function() {
							oExtensionAPI.securedExecution(function() {
								return oMultiEditContainer.getAllUpdatedContexts().then(function(aContexts) {
									return that._invokeActionsForMassChange(that._sActionName, aContexts, oExtensionAPI);
								});
							}, {
								dataloss: {
									popup: false
								}
							});
							oDialog.close();
						},
						onCancelPressed: function() {
							oDialog.close();
						}
					}));
				oMultiEditContainer = oDialog.getContent()[0];

				oParentView.addDependent(oDialog);
				oMultiEditContainer.setContexts(aContextsForEdit);

				oDialog.open();
			});

			oExtensionAPI.securedExecution(
				function() {
					return prepareDialog;
				}, {
					dataloss: {
						popup: false
					}
				});
		},

		_invokeActionsForMassChange: function(sAction, aContexts, oExtensionAPI) {
			var aContextsForProcessing = [],
				oMetaModel = this._oModel.getMetaModel(),
				oFunctionImport = oMetaModel.getODataFunctionImport(
					"EAM_OBJPG_MAINTENANCEORDER_SRV.EAM_OBJPG_MAINTENANCEORDER_SRV_Entities/" + sAction),
				oEntityType = oMetaModel.getODataEntityType(oFunctionImport["sap:action-for"]),
				aParameters = jQuery.map(oFunctionImport.parameter, function(oValue) {
					if (oEntityType.key.propertyRef.filter(function(oKey) {
							return oKey.name === oValue.name;
						}).length > 0) {
						return null;
					}
					return oValue.name;
				}),
				fnGetRelevantData = function(oContext) {
					var oData = {};
					for (var i = 0; i < aParameters.length; i++) {
						oData[aParameters[i]] = oContext.getProperty(aParameters[i]) || "";
					}
					return oData;
				},
				fnGetNotNullData = function(mData) {
					var mReturnData = {};
					for (var k in mData) {
						mReturnData[k] = mData[k] === null ? "" : mData[k];
					}
					return mReturnData;
				};

			for (var i in aContexts) {
				if (aContexts.hasOwnProperty(i)) {
					if (jQuery.isEmptyObject(aContexts[i].data)) {
						continue;
					}
				}
				aContextsForProcessing.push({
					context: aContexts[i].context,
					data: jQuery.extend({}, fnGetRelevantData(aContexts[i].context), fnGetNotNullData(aContexts[i].data))
				});
			}

			return this._splitActionInvocationForMassEdit(aContextsForProcessing, sAction, oExtensionAPI);
		},

		_splitActionInvocationForMassEdit: function(aContexts, sAction, oExtensionAPI) {
			var oPromise = Promise.resolve();

			for (var i = 0; i < aContexts.length; i++) {
				if (aContexts[i] === null) {
					continue;
				}

				var aCandidate = [aContexts[i].context];

				for (var j = i + 1; j < aContexts.length; j++) {
					if (jQuery.sap.equal(aContexts[i].data, aContexts[j].data)) {
						aCandidate.push(aContexts[j].context);
						aContexts[j] = null;
					}
				}

				// Same parameter tuple can go into one $batch, but not in same changeset (yet)
				// Different parameter tuples need to be submitted one after the other; otherwise the changesets will end up being merged!
				// This is probably a shortcoming of ApplicationControllers#invokeActions()
				oPromise = oPromise.then(jQuery.proxy(oExtensionAPI.invokeActions, oExtensionAPI,
					"EAM_OBJPG_MAINTENANCEORDER_SRV.EAM_OBJPG_MAINTENANCEORDER_SRV_Entities/" + sAction,
					aCandidate, aContexts[i].data)).catch(jQuery.noop);
			}
			return oPromise;
		}

	});
});