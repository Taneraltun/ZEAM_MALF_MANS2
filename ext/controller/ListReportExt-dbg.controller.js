sap.ui.define([
	"ZEAM_MALF_MANS/util/CustomMultiEditHandler"
], function (MultiEditHandler) {
	"use strict";
	return sap.ui.controller("ZEAM_MALF_MANS.ext.controller.ListReportExt", {
		//sap.ui.controller("ZEAM_MALF_MANS.ext.controller.ListReportExt", {
		onInit: function () {

			//set multi select
			this.getView().byId("responsiveTable").setMode("MultiSelect");
			
			
			this.getView().byId("ActionC_ObjPgMaintOrder1button").setIcon("sap-icon://add");//new
			this.getView().byId("ActionC_ObjPgMaintOrder2button").setIcon("sap-icon://edit");//change
			this.getView().byId("ActionC_ObjPgMaintOrder3button").setIcon("sap-icon://detail-view");//display
			
			//set useExportToExcel
			this.getView().byId("listReport").setProperty("useExportToExcel",true);
			
			// Disable navigation
			this.getView().byId("listReport").getTable().attachUpdateFinished(function (oEvent) {
				for (var j = 0; j < oEvent.getSource().getItems().length; j++) {
					// oEvent.getSource().getItems()[j].setType(sap.m.ListType.Inactive);
					oEvent.getSource().getItems()[j].getAggregation("cells")[0].getAggregation("items")[0].mEventRegistry.press = "";
				}
			});
		},
		onClickActionC_ObjPgMaintOrder1: function (oEvent) {
			//new
			var oCrossAppNav = sap.ushell && sap.ushell.Container && sap.ushell.Container.getService("CrossApplicationNavigation");
			var href_display = (oCrossAppNav && oCrossAppNav.toExternal({
				target: {
					shellHash: "ZPM_MALF_NOTIF-create"
				}
			})) || "";
		},
		onClickActionC_ObjPgMaintOrder2: function (oEvent) {
			//change
			var vI18n = this.getView().getModel("i18n").getResourceBundle();
			if (this.getView().byId("listReport").getTable().getSelectedItem() === null) {
				sap.m.MessageBox.error(vI18n.getText("SelectLine"));
			} else {
				var oMaintenanceNotification = this.getView().byId("listReport").getTable().getSelectedItem().getBindingContext().getProperty(
					"MaintenanceOrder");
				var vShellHash = "ZPM_MALF_NOTIF-change?MaintenanceNotification=" + oMaintenanceNotification;
				var oCrossAppNav = sap.ushell && sap.ushell.Container && sap.ushell.Container.getService("CrossApplicationNavigation");
				var href_display = (oCrossAppNav && oCrossAppNav.toExternal({
					target: {
						shellHash: vShellHash
					}
				})) || "";
			}
		},
		onClickActionC_ObjPgMaintOrder3: function (oEvent) {
			//display
			var vI18n = this.getView().getModel("i18n").getResourceBundle();
			if (this.getView().byId("listReport").getTable().getSelectedItem() === null) {
				sap.m.MessageBox.error(vI18n.getText("SelectLine"));
			} else {
				var oMaintenanceNotification = this.getView().byId("listReport").getTable().getSelectedItem().getBindingContext().getProperty(
					"MaintenanceOrder");
				var vShellHash = "ZPM_MALF_NOTIF-display?MaintenanceNotification=" + oMaintenanceNotification;
				//launchpad navigation için bu component kullanılır 
				var oCrossAppNav = sap.ushell && sap.ushell.Container && sap.ushell.Container.getService("CrossApplicationNavigation");
				var href_display = (oCrossAppNav && oCrossAppNav.toExternal({
					target: {
						shellHash: vShellHash
					}
				})) || "";
			}
		},
		//Global variables
		_aMaintenanceOrder: [],
		_sAction: {},
		_oActionNames: {
			buco: "CompleteBusinessAction",
			teco: "CompleteTechnicalAction",
			donotexec: "DoNotExecuteAction",
			cancelteco: "CancelTechnicalCompleteAction"
		},

		adaptTransientMessageExtension: function () {
			var oMessageManager = sap.ui.getCore().getMessageManager(),
				oMessageModel = oMessageManager.getMessageModel(),
				aMessages = oMessageModel.getData();

			if (aMessages.length) {
				aMessages.forEach(function (mMessage) {
					if (mMessage.type === sap.ui.core.MessageType.Error && mMessage.code === "/BOBF/FRW_COMMON/094") {
						var oNewMessage = new sap.ui.core.message.Message({
							target: mMessage.target,
							type: sap.ui.core.MessageType.Error,
							persistent: true,
							message: this.oView.getModel("@i18n").getProperty("xmsg.statusOfOrderDoesNotAllowChanges")
						});
						oMessageManager.removeMessages(mMessage);
						oMessageManager.addMessages(oNewMessage);
					}
				}.bind(this), []);
			}
		},

		onLongTextDialogClose: function (oEvent) {
			oEvent.getSource().getParent().close();
		},

		onShowLongTextDialog: function (oEvent) {
			var oDialog = sap.ui.xmlfragment(this.getView().getId(), "ZEAM_MALF_MANS.ext.fragments.LongTextDialog", this);

			var sOrderWithDescBindingPath = this.getView().getModel().createKey("/C_ObjPgMaintOrderWthDesc", {
				MaintenanceOrder: oEvent.getSource().getBindingContext().getObject().MaintenanceOrder
			});

			oDialog.bindElement({
				path: sOrderWithDescBindingPath,
				events: {
					dataRequested: function () {
						oDialog.setBusy(true);
					},
					dataReceived: function () {
						oDialog.setBusy(false);
					}
				}
			});

			this.getView().addDependent(oDialog);
			oDialog.open();
		},

		onCompleteTechnicalPressed: function (oEvent) {
			this.onClickStatusAction(this._oActionNames.teco);
		},

		onCompleteBusinessPressed: function (oEvent) {
			this.onClickStatusAction(this._oActionNames.buco);
		},

		onDoNotExecutePressed: function (oEvent) {
			this.onClickStatusAction(this._oActionNames.donotexec);
		},

		onCancelTechnicalComplPressed: function (oEvent) {
			this.onClickStatusAction(this._oActionNames.cancelteco);
		},

		onClickStatusAction: function (sActionName) {
			var oDialog = {};

			//store the id of the pressed button for using in other context
			this._sAction = sActionName;
			//load order data
			var oContexts = this.extensionAPI.getSelectedContexts();

			// Leave if no rows are selected
			if (oContexts.length === 0) {
				return;
			}

			//get User settings from the first context row (all contains the same)
			var sBusinessCompleteControl = oContexts[0].getObject().CompleteBusinessAndSetNotifSts;
			var sTechnicalCompleteControl = oContexts[0].getObject().CompleteTechlyAndSetNotifSts;
			var sDoNotExecuteControl = oContexts[0].getObject().DoNotExectOrderAndSetNotifSts;
			var sResetTechCompleteControl = oContexts[0].getObject().ResetTechCompltnAndSetNotifSts;

			//store OrderIDs as global variable (for later use)
			for (var i = 0; i < oContexts.length; i++) {
				this._aMaintenanceOrder[i] = {};
				this._aMaintenanceOrder[i].MaintenanceOrder = oContexts[i].getObject().MaintenanceOrder;

				// Read date values to set the proper reference date if technical complete is pressed
				if (this._sAction === this._oActionNames.teco) {
					switch (oContexts[i].getObject().RefTimeForOrderCompletion) {
					case "2": // Basic Start Date 
						this._aMaintenanceOrder[i].ReferenceDate = (oContexts[i].getObject().MaintOrdBasicStartDate === "") ? new Date() : oContexts[i]
							.getObject().MaintOrdBasicStartDate;
						break;
					case "3": // Basic End date
						this._aMaintenanceOrder[i].ReferenceDate = (oContexts[i].getObject().MaintOrdBasicEndDate === "") ? new Date() : oContexts[i].getObject()
							.MaintOrdBasicEndDate;
						break;
					default: // Current date is set as default then the user can change it
						this._aMaintenanceOrder[i].ReferenceDate = new Date();
						break;
					}
				}
			}

			// create different InputModels (based on the action name) that is bound to the dialog texts and input fields
			var oDialogData = this._fillDialogInputModel(this._sAction, sTechnicalCompleteControl, sBusinessCompleteControl,
				sDoNotExecuteControl, sResetTechCompleteControl);

			if (oDialogData.openDialog === false) {
				// According the customizing data no dialog shall be opened
				this._executeQuickAction(oDialogData.model);
			} else {
				//open the proper dialog
				if (oDialogData.datePicker === true) {
					oDialog = sap.ui.xmlfragment("ZEAM_MALF_MANS.ext.fragments.DateSelectorDialog", this);
				} else {
					oDialog = sap.ui.xmlfragment("ZEAM_MALF_MANS.ext.fragments.SelectionDialog", this);
				}
				this.getView().addDependent(oDialog);
				this.getView().setModel(oDialogData.model, "InputModel");
				oDialog.open();
			}
		},

		onChangeAssignmentPressed: function () {
			var oMultiEditHandler = new MultiEditHandler(this.getView().getModel(), "C_ObjPgMaintOrderChangeassgmt",
				"ZEAM_MALF_MANS.ext.fragments.ChangeAssignmentDialog");
			oMultiEditHandler.showDialog(this.getView(), this.extensionAPI.getSelectedContexts());
		},

		onChangeSchedulingPressed: function (oPressEvent) {
			var aSelectedContexts = this.extensionAPI.getSelectedContexts(),
				oI18nBundle = oPressEvent.getSource().getModel("@i18n").getResourceBundle();
			var oMultiEditHandler = new MultiEditHandler(this.getView().getModel(), "C_ObjPgMaintOrderChangescheduling",
				"ZEAM_MALF_MANS.ext.fragments.ChangeSchedulingDialog");

			oMultiEditHandler.attachEvent("beforeRetrieveMissingData", function (oEvent) {
				// this is to ensure that we have the suggested dates available from the beginning
				oEvent.getParameter("expand").push("to_MaintPrioSmltdDates", "to_MaintenanceRevision", "to_SchedulingParameters");
				oEvent.getParameter("select").push("to_MaintPrioSmltdDates/*", "to_MaintenanceRevision/*", "to_SchedulingParameters/*");
			});

			oMultiEditHandler.attachEvent("valueOptionSelected", function (oEvent) {
				var sFieldNameFromEvent = oEvent.getParameter("fieldName"),
					fnAddProposedDate = function (sParameterName, sProposalIdentifier, vProposal) {
						// first, get all current custom options, leaving out any with same proposal identifier
						var aOptions = oMultiEditHandler.getCustomValueOptions(sParameterName).filter(function (oItem) {
							return oItem && oItem.data(sProposalIdentifier) !== true;
						});
						if (vProposal && vProposal instanceof Date) {
							// valid date was passsed, add it to custom options array.
							var oItem = new sap.ui.core.Item({
								text: oI18nBundle.getText("xlst.date_" + sProposalIdentifier, [sap.ui.core.format.DateFormat
									.getDateInstance().format(vProposal)
								]),
								key: sProposalIdentifier
							});
							oItem.data(sProposalIdentifier, true);
							oItem.data("date", vProposal);
							aOptions.push(oItem);
						}
						// write back custom options
						oMultiEditHandler.setCustomValueOptions(sParameterName, aOptions);
					}.bind(this),
					fnValuesOccur = function (sProperty, vValue) {
						var aValues = Array.prototype.slice.call(arguments, 1);
						return aSelectedContexts.some(function (oContext) {
							var vMyValue = oContext.getProperty(sProperty);
							if (aValues.length === 1) {
								return vMyValue === vValue;
							} else {
								return aValues.indexOf(vMyValue) !== -1;
							}
						});
					};

				switch (sFieldNameFromEvent) {
				case "MaintenancePlanningPlant":
				case "MaintPriorityType":
					if (oEvent.getParameter("isFirstTime") && !oEvent.getParameter("isConcreteValue")) {
						oMultiEditHandler.attachEventOnce("beforeDialogOpens", oEvent.getParameter("fieldName") === "MaintPriorityType" ? [
							"orderChangeSchedulingPriorityMassEditComboBox"
						] : ["orderChangeSchedulingMaintenanceRevisionMassEditComboBox"], function (oDialogOpenEvent, aFields) {
							aFields.forEach(function (sFieldName) {
								sap.ui.getCore().byId(sFieldName).setEnabled(false);
							});
						}, this);
					}
					break;
				case "MaintPriority":
					if (oEvent.getParameter("isConcreteValue")) {
						this.getModel().createBindingContext(this.getModel().createKey("/C_MaintPrioSmltdDates", {
							MaintPriorityType: aSelectedContexts[0].getProperty("MaintPriorityType"),
							MaintPriority: oEvent.getParameter("selectedOptionKey")
						}), function (oPriority) {
							fnAddProposedDate("MaintOrdBasicStartDate", "fromPriority", oPriority && oPriority.getProperty(
									"RequiredStartDateByPriority") ||
								null);
							fnAddProposedDate("MaintOrdBasicEndDate", "fromPriority", oPriority && oPriority.getProperty("RequiredEndDateByPriority") ||
								null);
						});
					} else {
						// not a concrete value -- remove our proposed dates
						fnAddProposedDate("MaintOrdBasicStartDate", "fromPriority");
						fnAddProposedDate("MaintOrdBasicEndDate", "fromPriority");
					}
					break;
				case "MaintenanceRevision":
					if (oEvent.getParameter("isConcreteValue")) {
						this.getModel().createBindingContext(this.getModel().createKey("/I_MaintenanceRevision", {
							MaintenancePlanningPlant: aSelectedContexts[0].getProperty("MaintenancePlanningPlant"),
							MaintenanceRevision: oEvent.getParameter("selectedOptionKey")
						}), function (oRevision) {
							fnAddProposedDate("MaintOrdBasicStartDate", "fromRevision", oRevision && oRevision.getProperty("RevisionStartDate") || null);
							fnAddProposedDate("MaintOrdBasicEndDate", "fromRevision", oRevision && oRevision.getProperty("RevisionEndDate") || null);
						});
					} else {
						// not a concrete value -- remove our proposed dates
						fnAddProposedDate("MaintOrdBasicStartDate", "fromRevision");
						fnAddProposedDate("MaintOrdBasicEndDate", "fromRevision");
					}
					break;
				case "MaintOrdBasicStartDate":
				case "MaintOrdBasicEndDate":
					var bIsChange = (oEvent.getParameter("isConcreteValue") || oEvent.getParameter("isLeaveBlank")) || false,
						dDate,
						oCombobox = sap.ui.getCore().byId("orderChangeScheduling" + sFieldNameFromEvent + "MassEditComboBox");
					if (oEvent.getParameter("isCustomOption") === true) {
						// user has selected proposal date. set proposal date into parameter context
						var oItem = oEvent.getParameter("selectedCustomOptionItem");
						dDate = oItem ? oItem.data("date") : null;
						if (dDate) {
							this.getModel().setProperty(oEvent.getParameter("inputContext").getPath() + "/" + oEvent.getParameter("fieldName"), dDate);
							oEvent.preventDefault();
							bIsChange = true;
						}
					}
					if (bIsChange) {
						if (!dDate) {
							dDate = new Date(oEvent.getParameter("selectedOptionKey"));
						}
						if (( /*basic start date lies in the past (before today)*/
								sFieldNameFromEvent === "MaintOrdBasicStartDate" && dDate && dDate < new Date(new Date().setHours(0, 0, 0, 0))) ||
							fnValuesOccur("OrdIsNotSchedldAutomatically", false) && fnValuesOccur("to_SchedulingParameters/AdjustmentOfBasicDates", "",
								"1") &&
							((
								/*basic start date in combination with scheduling types 2,4,6*/
								sFieldNameFromEvent === "MaintOrdBasicStartDate" && fnValuesOccur("BasicSchedulingType", "2", "4", "6")) || (
								/*basic end date in combination with scheduling types 1,4,5*/
								sFieldNameFromEvent === "MaintOrdBasicEndDate" && fnValuesOccur("BasicSchedulingType", "1", "4", "5")))) {
							oCombobox.setValueState(sap.ui.core.ValueState.Warning).setValueStateText(oI18nBundle.getText(
								"xmsg.automaticSchedulingMayOverrideThisDateWarning"));
						} else {
							oCombobox.setValueState(sap.ui.core.ValueState.None).setValueStateText();
						}
					} else {
						oCombobox.setValueState(sap.ui.core.ValueState.None).setValueStateText();
					}

					break;
				}
			}.bind(oPressEvent.getSource()));

			oMultiEditHandler.showDialog(this.getView(), aSelectedContexts);
		},

		onCancelStatusDialog: function (oEvent) {
			this._ExitAndDestroyDialog(oEvent.getSource().getParent());
		},

		onAcceptStatusDialog: function (oEvent) {
			//get date from dialog (default value is current time)
			var oInputModel = this.getView().getModel("InputModel");

			//call Function Import and handle response
			this._executeQuickAction(oInputModel);

			//close dialog
			this._ExitAndDestroyDialog(oEvent.getSource().getParent());
		},

		_ExitAndDestroyDialog: function (oDialog) {
			this._aMaintenanceOrder = [];
			oDialog.close();
			oDialog.destroy(true);
		},

		// The properties of the InputModel is bound to the dialog screen elements; or in background mode it is prefilled based on the customizing values
		_fillDialogInputModel: function (sActionName, sTechnicalCompleteControl, sBusinessCompleteControl, sDoNotExecuteControl,
			sResetTechCompleteControl) {
			var bDatePickerDialog = false;
			var bOpenDialog = true;
			var oInputModel = new sap.ui.model.json.JSONModel();
			var dReferenceDate = new Date();
			var oI18nModelObjectPage = this.getView().getModel("i18n|sap.suite.ui.generic.template.ListReport|C_ObjPgMaintOrder");

			switch (sActionName) {
			case this._oActionNames.teco:
				//If the control attribute is not initial, use its settings to set value in the model
				//Otherwise prepare the InputModel for the dialogscreen (the properties are bound to the ui elements)
				if (sTechnicalCompleteControl !== "") {
					oInputModel.setProperty("/completeNotification", (sTechnicalCompleteControl === "A") ? true : false);
					bOpenDialog = false;
				} else {
					// If only 1 row is selected read the prefilled date of the order according to the customizing; other case show the current date
					if (this._aMaintenanceOrder.length === 1) {
						dReferenceDate = this._aMaintenanceOrder[0].ReferenceDate;
					}
					oInputModel.setData({
						completionDate: dReferenceDate,
						completeNotification: false,
						dialogTitle: this.getView().getModel("@i18n").getResourceBundle().getText("@CompleteTechnicalLabel"),
						buttonText: this.getView().getModel("@i18n").getResourceBundle().getText("@CompleteTechnicalLabel")
					});
					bDatePickerDialog = true;
				}
				break;
			case this._oActionNames.buco:
				oInputModel.setData({
					completionDate: new Date(),
					completeNotification: false,
					dialogTitle: this.getView().getModel("@i18n").getResourceBundle().getText("@CompleteBusinessLabel"),
					buttonText: this.getView().getModel("@i18n").getResourceBundle().getText("@CompleteBusinessLabel")
				});

				//If the control attribute is not initial, use its settings to set value in the model
				if (sBusinessCompleteControl !== "") {
					oInputModel.setProperty("/completeNotification", (sBusinessCompleteControl === "A") ? true : false);
					bOpenDialog = false;
				} else {
					bDatePickerDialog = true;
				}
				break;
			case this._oActionNames.donotexec:
				//If the control attribute is not initial, use its settings to set value in the model
				switch (sDoNotExecuteControl) {
				case "A":
					oInputModel.setData({
						selectedKey: "DO_NOT_EXEC_NOTIF_CLOSE"
					});
					bOpenDialog = false;
					break;
				case "D":
					oInputModel.setData({
						selectedKey: "DO_NOT_EXEC_NOTIF_DEALLOC"
					});
					bOpenDialog = false;
					break;
				case "N":
					oInputModel.setData({
						selectedKey: "DO_NOT_EXECUTE"
					});
					bOpenDialog = false;
					break;
				case "": //do not select key and open dialog	
					oInputModel.setData({
						listitems: [{
							technicalId: "DO_NOT_EXECUTE",
							description: oI18nModelObjectPage.getResourceBundle().getText("xsel.donotexecuteDoNotChange")
						}, {
							technicalId: "DO_NOT_EXEC_NOTIF_CLOSE",
							description: oI18nModelObjectPage.getResourceBundle().getText("xsel.donotexecuteComplete")
						}, {
							technicalId: "DO_NOT_EXEC_NOTIF_DEALLOC",
							description: oI18nModelObjectPage.getResourceBundle().getText("xsel.donotexecuteRemove")
						}],
						selectedKey: "DO_NOT_EXECUTE",
						isWarningNeeded: true,
						dialogTitle: this.getView().getModel("@i18n").getResourceBundle().getText("@DoNotExecuteLabel"),
						dropdownLabel: oI18nModelObjectPage.getResourceBundle().getText("xfld.notificationStatus"),
						buttonText: this.getView().getModel("@i18n").getResourceBundle().getText("@DoNotExecuteLabel")
					});
					break;
				}
				break;
			case this._oActionNames.cancelteco:
				//If the control attribute is not initial, use its settings to set value in the model
				switch (sResetTechCompleteControl) {
				case "A":
					oInputModel.setData({
						selectedKey: "CANCEL_TECO_WITH_NOTIF"
					});
					bOpenDialog = false;
					break;
				case "N":
					oInputModel.setData({
						selectedKey: "CANCEL_TECHNICAL_COMPLETION"
					});
					bOpenDialog = false;
					break;
				case "": //do not select key and open dialog	
					oInputModel.setData({
						listitems: [{
							technicalId: "CANCEL_TECO_WITH_NOTIF",
							description: oI18nModelObjectPage.getResourceBundle().getText("xsel.canceltecoPutinProcess"),
							selected: false
						}, {
							technicalId: "CANCEL_TECHNICAL_COMPLETION",
							description: oI18nModelObjectPage.getResourceBundle().getText("xsel.canceltecoKeepCompleted"),
							selected: false
						}],
						selectedKey: "CANCEL_TECO_WITH_NOTIF",
						isWarningNeeded: false,
						dialogTitle: this.getView().getModel("@i18n").getResourceBundle().getText("@CancelTechnicalCompleteLabel"),
						dropdownLabel: oI18nModelObjectPage.getResourceBundle().getText("xfld.notificationStatus"),
						buttonText: this.getView().getModel("@i18n").getResourceBundle().getText("@CancelTechnicalCompleteLabel")
					});
					break;
				}
				break;
			default:
				break;
			}
			return {
				model: oInputModel,
				datePicker: bDatePickerDialog,
				openDialog: bOpenDialog
			};
		},

		_executeQuickAction: function (oInputModel) {
			var sFunctionName = "";
			var sActionName = "";
			var sRefDateTime = "";
			var fnFunction = {};
			var oBackendPromise = {};

			// Prepare action call
			switch (this._sAction) {
			case this._oActionNames.teco:
				sFunctionName = "/C_ObjPgMaintOrderCompletetechnical";
				sActionName = (oInputModel.getProperty("/completeNotification") === true) ? "TECO_WITH_NOTIF" : "SET_STATUS_ORD_COMPLETE_TEC";
				sRefDateTime = oInputModel.getProperty("/completionDate");
				break;
			case this._oActionNames.buco:
				sFunctionName = "/C_ObjPgMaintOrderCompletebusiness";
				sActionName = (oInputModel.getProperty("/completeNotification") === true) ? "BUS_COMPL_WITH_NOTIF" : "COMPLETE_BUSINESS";
				sRefDateTime = oInputModel.getProperty("/completionDate");
				break;
			case this._oActionNames.donotexec:
				sFunctionName = "/C_ObjPgMaintOrderDonotexecute";
				sActionName = oInputModel.getProperty("/selectedKey");
				break;
			case this._oActionNames.cancelteco:
				sFunctionName = "/C_ObjPgMaintOrderCanceltechnicalcomplete";
				sActionName = oInputModel.getProperty("/selectedKey");
				break;
			}

			//setup function call
			var oExtensionApi = this.extensionAPI;
			fnFunction = this._functionImportCallback(sFunctionName, this.getView().getModel(), this._aMaintenanceOrder, sRefDateTime,
				sActionName);

			//call function with secured synchronous call
			oBackendPromise = oExtensionApi.securedExecution(fnFunction);
			oBackendPromise.then(function () {
				//refresh table
				oExtensionApi.refreshTable();
			});
		},

		_functionImportCallback: function (sActionPath, oModel, aSelectedOrders, sRefDateTime, sActionName) {
			return function () {
				var oPromise = new Promise(function (fnResolve, fnReject) {
					var oUrlParams = {};
					for (var i = 0; i < aSelectedOrders.length; i++) {
						oUrlParams = {
							MaintenanceOrder: aSelectedOrders[i].MaintenanceOrder,
							ActionName: sActionName
						};

						if (sRefDateTime !== undefined) { // Reference Date was given in the dialog so the same value is relevant for all the items
							oUrlParams.RefDatetime = sRefDateTime;
						} else if (sActionPath.match(/Completetechnical/)) { // The customizing about the date is set and background mode is enabled for Complete Technically
							oUrlParams.RefDatetime = aSelectedOrders[i].ReferenceDate;
						}
						//actions without DateTime parameter
						oModel.callFunction(sActionPath, {
							method: "POST",
							urlParameters: oUrlParams,
							changeSetId: "changeSetId" + i,
							refreshAfterChange: "true",
							success: fnResolve,
							error: fnReject
						});
					}
				});
				return oPromise;
			};
		}
	});
});