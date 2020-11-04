/*
 * Copyright (C) 2009-2019 SAP SE or an SAP affiliate company. All rights reserved.
 */
sap.ui.define([
	"sap/ui/base/EventProvider"
], function (EventProvider) {
	"use strict";

	var fnFindAllControlsByType = function (oControl, fnType) {
			var mDefaultAggregation = oControl.getMetadata ? oControl.getMetadata().getDefaultAggregation() : {};
			if (mDefaultAggregation && mDefaultAggregation._sGetter) {
				var aAggregationItems = oControl[mDefaultAggregation._sGetter]();
				return aAggregationItems.reduce(function (aItems, oItem) {
					if (oItem instanceof fnType) {
						aItems.push(oItem);
						return aItems;
					}
					if (!oItem.getMetadata) {
						return aItems;
					}
					var aSubItems = fnFindAllControlsByType(oItem, fnType);
					if (aSubItems && aSubItems.length) {
						return aItems.concat(aSubItems);
					}
					return aItems;
				}, []);
			}
			return [];
		},
		_DateType = sap.ui.model.odata.type.DateTime.extend("i2d.eam.order.manages1.util.CustomMultiEditHandler.dateType", {
			_oViewModelContext: null,

			constructor: function (oViewModelContext) {
				this._oViewModelContext = oViewModelContext;

				return sap.ui.model.odata.type.DateTime.call(this, undefined, {
					displayFormat: "Date"
				});
			},

			formatValue: function (oValue, sTargetType) {
				if (oValue instanceof Date) {
					return sap.ui.model.odata.type.DateTime.prototype.formatValue.apply(this, arguments);
				} else if (typeof oValue === "undefined") {
					return null;
				}
				return oValue;
			},

			parseValue: function (sValue, sSourceType) {
				if (sSourceType === "string") {
					if (this._oViewModelContext.getProperty("massEditValues").some(function (mOption) {
							return (mOption.semantic !== "ConcreteValue" && mOption.value === sValue);
						})) {
						// Accepted
						return sValue;
					}
				}

				var oParseResult = sap.ui.model.odata.type.DateTime.prototype.parseValue.apply(this, arguments);
				// parseValue will also make attempts at guessing/autocompleting. For example, 12/31/2 becomes 12/31/2002.
				// This behavior is disruptive if the user is still typing, as they might have wanted to type a year number
				// (Observed behavior: ComboBox updates binding after every typed character)
				if (this.formatValue(oParseResult, "string") !== sValue) {
					// stolen from getErrorMessage in sap.ui.model.odata.type.DateTimeBase
					throw new sap.ui.model.ParseException(sap.ui.getCore().getLibraryResourceBundle().getText("EnterDate", [this.formatValue(new Date(
						Date.UTC(new Date().getFullYear(), 11, 31)), "string")]));
				}
				return oParseResult;
			},

			validateValue: function () {
				return;
			}
		});

	return EventProvider.extend("i2d.eam.order.manages1.util.CustomMultiEditHandler", {

		_aFields: null,
		_aDependentFields: null,
		_mFieldDependencies: null,
		_oModel: null,
		_oViewModel: null,
		_sDialogFragment: null,
		_sActionName: null,
		_oEntityType: null,
		_oDialog: null,
		_oParameterContext: null,
		//
		constructor: function (oModel, sActionName, sDialogFragment) {
			EventProvider.prototype.constructor.call(this);

			this._oModel = oModel;
			this._sActionName = sActionName;
			this._sDialogFragment = sDialogFragment;

			var oMetaModel = this._oModel.getMetaModel(),
				oFunctionImport = oMetaModel.getODataFunctionImport(
					"EAM_OBJPG_MAINTENANCEORDER_SRV.EAM_OBJPG_MAINTENANCEORDER_SRV_Entities/" + this._sActionName);
			this._oEntityType = oMetaModel.getODataEntityType(oFunctionImport["sap:action-for"]);
			this._aFields = oFunctionImport.parameter.reduce(function (aFields, mParameter) {
				if (this._oEntityType.key.propertyRef.filter(function (oKey) {
						return oKey.name === mParameter.name;
					}).length > 0) {
					return aFields;
				}
				aFields.push(mParameter.name);
				return aFields;
			}.bind(this), []);
			this._aDependentFields = [];
		},

		showDialog: function (oParentView, aContextsForEdit) {
			var that = this,
				mParameterMapping = {},
				aExpandsToRetrieve = [],
				oExtensionAPI = oParentView.getController().extensionAPI,
				oMetaModel = this._oModel.getMetaModel();

			// get dependent fields, e.g. plant, and text fields
			this._aFields.forEach(function (sFieldName) {
				var oFieldMetadata = oMetaModel.getODataProperty(that._oEntityType, sFieldName);
				if (oFieldMetadata && oFieldMetadata["com.sap.vocabularies.Common.v1.Text"] && oFieldMetadata[
						"com.sap.vocabularies.Common.v1.Text"].Path) {
					var aParts = oFieldMetadata["com.sap.vocabularies.Common.v1.Text"].Path.split("/");
					if (aParts.length === 2) {
						aExpandsToRetrieve.push(aParts[0]);
					}
					that._aDependentFields.push(aParts.join("/"));
				}

				if (oFieldMetadata && oFieldMetadata["com.sap.vocabularies.Common.v1.ValueList"]) {
					oFieldMetadata["com.sap.vocabularies.Common.v1.ValueList"].Parameters.forEach(function (mValueListParameter) {
						if (!mValueListParameter.RecordType || mValueListParameter.RecordType.indexOf("ValueListParameterInOut") === -1 || !
							mValueListParameter.LocalDataProperty || !mValueListParameter.LocalDataProperty.PropertyPath || mValueListParameter.LocalDataProperty
							.PropertyPath === sFieldName || that._aFields.indexOf(mValueListParameter.LocalDataProperty.PropertyPath) !== -1) {
							return;
						}
						that._aDependentFields.push(mValueListParameter.LocalDataProperty.PropertyPath);
					});
				}
			});

			// only for fields which are visible
			this._mFieldDependencies = this._aFields.reduce(function (mMap, sFieldName) {
				mMap[sFieldName] = [];
				return mMap;
			}, {});

			var aFieldsToRetrieve = this._aFields.concat(this._aDependentFields).filter(function (sField) {
					// all selected contexts need to have this field, otherwise we will have to fetch data from backend before the dialog opens
					return aContextsForEdit.filter(function (oSelectedContext) {
						return typeof oSelectedContext.getProperty(sField) === "undefined";
					}).length > 0;
				}),
				prepareDialog;

			this.fireEvent("beforeRetrieveMissingData", {
				select: aFieldsToRetrieve,
				expand: aExpandsToRetrieve
			});
			if (aFieldsToRetrieve.length) {
				prepareDialog = Promise.all(aContextsForEdit.map(function (oSelectedContext) {
					return new Promise(function (resolve, reject) {
						that._oModel.read(oSelectedContext.getPath(), {
							urlParameters: {
								$select: aFieldsToRetrieve.join(),
								$expand: aExpandsToRetrieve.join()
							},
							success: resolve,
							error: reject
						});
					});
				}));
			} else {
				prepareDialog = Promise.resolve();
			}

			this._prepareModel();
			var oParameterContext = this._oModel.createEntry(aContextsForEdit[0].getPath().match(/^\/(.*?)\(.*\)$/)[1], {
				groupId: "BreakoutActionParameters",
				properties: this._aFields.concat(this._aDependentFields).reduce(function (mMap, sFieldName) {
					mMap[sFieldName] = null;
					return mMap;
				}, {})
			});
			this._oParameterContext = oParameterContext;

			prepareDialog.then(function () {
				var mViewData = that._proposeParametersForMassEdit(oParentView, aContextsForEdit, oParameterContext, mParameterMapping);
				mViewData.IsInValueHelpMode = true;

				var oViewModel = new sap.ui.model.json.JSONModel(mViewData);
				that._oViewModel = oViewModel;

				that._aFields.concat(that._aDependentFields).forEach(function (sFieldName) {
					// publish initially selected values via event
					var sSelectedKey = mViewData[sFieldName] ? mViewData[sFieldName].selectedKey : oParameterContext.getProperty(sFieldName);
					try {
						that.fireEvent("valueOptionSelected", {
							isFirstTime: true,
							isKeep: sSelectedKey === "_KEEP",
							isLeaveBlank: !sSelectedKey || sSelectedKey === "_BLANK",
							isConcreteValue: sSelectedKey && sSelectedKey.substring(0, 1) !== "_",
							isCustomOption: false, // can't/shouldn't be
							fieldName: sFieldName,
							selectedOptionKey: sSelectedKey,
							selectedCustomOptionItem: null // probably not rendered yet
						}, true);
					} catch (e) {}
				});

				that._showDialog(oParentView, that._sDialogFragment, oExtensionAPI, oParameterContext, oViewModel)
					.then(function (bIsOk) {
						// dialog was closed, either with Ok or Cancel
						if (!bIsOk) {
							// cancel was pressed
							return Promise.resolve();
						}

						var mParameters = that._getParametersForSubmit(oParameterContext);
						return oExtensionAPI.securedExecution(
							jQuery.proxy(that._splitActionInvocationForMassEdit, that,
								aContextsForEdit,
								that._sActionName,
								mParameters,
								oViewModel.getProperty("/"),
								oExtensionAPI), {
								dataloss: {
									popup: false
								}
							});
					}).then(function () {
						that._oModel.deleteCreatedEntry(oParameterContext);
					});
			});

			oExtensionAPI.securedExecution(
				function () {
					return prepareDialog;
				}, {
					dataloss: {
						popup: false
					}
				});
		},

		getDialog: function () {
			return this._oDialog;
		},

		getCustomValueOptions: function (sFieldName) {
			return this._oViewModel.getProperty("/" + sFieldName + "/massEditValues").reduce(function (aOptions, mItem) {
				if (mItem.semantic === "Custom") {
					aOptions.push(sap.ui.getCore().byId(mItem.id));
				}
				return aOptions;
			}, []);

		},

		setCustomValueOptions: function (sFieldName, aOptionItems) {
			// get all current options without custom ones
			var iSeam = -1,
				aOptions = this._oViewModel.getProperty("/" + sFieldName + "/massEditValues").filter(function (mItem, iIndex) {
					if (mItem.semantic !== "Custom" && mItem.semantic !== "ConcreteValue") {
						iSeam = iIndex + 1;
					}
					return mItem.semantic !== "Custom";
				}),
				fnCustomKeyExists = function (mItem) {
					return mItem.key === sSelectedKey && mItem.semantic === "Custom";
				};

			if (iSeam === -1) {
				// when in doubt, append to the end of the array.
				iSeam = aOptions.length;
			}

			// check current field option
			var sSelectedKey = this._oViewModel.getProperty("/" + sFieldName + "/selectedKey"),
				oSelectedItem,
				bSelectedKeyIsCustomValueOption = this._oViewModel.getProperty("/" + sFieldName + "/massEditValues").some(fnCustomKeyExists);

			var aCustomOptions = aOptionItems.reduce(function (aArray, oItem) {
				// check for existence of current field option
				if (oItem.getKey() === sSelectedKey) {
					oSelectedItem = oItem;
				}

				return aArray.concat({
					key: oItem.getKey(),
					value: oItem.getText(),
					id: oItem.getId(),
					semantic: "Custom"
				});
			}, []);

			Array.prototype.splice.apply(aOptions, [iSeam, 0].concat(aCustomOptions));

			this._oViewModel.setProperty("/" + sFieldName + "/massEditValues", aOptions);

			if (bSelectedKeyIsCustomValueOption) {
				if (aOptions.some(fnCustomKeyExists)) {
					// retrigger selection event
					try {
						this.fireEvent("valueOptionSelected", {
							isFirstTime: false,
							isKeep: false,
							isLeaveBlank: false,
							isConcreteValue: true,
							isCustomOption: true,
							fieldName: sFieldName,
							selectedOptionKey: sSelectedKey,
							selectedCustomOptionItem: oSelectedItem
						}, true);
					} catch (e) {}
				} else {
					// trigger re-processing so that value becomes independent
					this._processParametersForMassEdit(this._oDialog.getBindingContext(), this._oViewModel, sFieldName);
				}
			}
		},

		_showDialog: function (oParentView, sFragmentName, oExtensionAPI, oContext, oViewModel) {
			var that = this;

			return new Promise(function (resolve, reject) {
				var oDialog = sap.ui.xmlfragment(sFragmentName, new(sap.ui.core.mvc.Controller.extend(sFragmentName + "Controller", {
					afterDialogClosed: function () {
						oParentView.removeDependent(oDialog);
						oDialog.destroy();
					},
					onOkPressed: function () {
						if (sap.ui.getCore().getMessageManager().getMessageModel().getObject("/").some(function (oMessage) {
								if (oMessage.getType() === sap.ui.core.MessageType.Error) {
									var oControl = sap.ui.getCore().byId(oMessage.getControlId());
									if (oControl instanceof sap.m.InputBase) {
										oControl.focus();
									}
									return true;
								}
								return false;
							})) {
							// Error message is present in model
							return;
						}

						oDialog.close();
						resolve(true);
					},
					onCancelPressed: function () {
						oDialog.close();
						resolve(false);
					},
					onMassEditComboBoxChanged: function (oEvent) {
						var bContinue, oComboBox = oEvent.getSource(),
							oSelectedItem = oComboBox.getSelectedItem(),
							oInputContext = oComboBox.getBindingContext(),
							oViewModelContext = oComboBox.getBindingContext("viewModel"),
							sFieldName = oViewModelContext.getPath().substring(1),
							sPreviousKey = oViewModelContext.getProperty("previousSelectedKey"),
							oSmartControl = sap.ui.getCore().byId(oComboBox.data("smartFieldId"));

						try {
							bContinue = that.fireEvent("valueOptionSelected", {
								isKeep: oSelectedItem && oSelectedItem.data("semantic") === "KeepValue" || false,
								isLeaveBlank: oSelectedItem && oSelectedItem.data("semantic") === "LeaveBlank" || false,
								isConcreteValue: oSelectedItem && oSelectedItem.data("semantic") === "ConcreteValue" || (oSelectedItem ? false : true), // manually entered is considered a concrete value!
								isCustomOption: oSelectedItem && oSelectedItem.data("semantic") === "Custom" || false,
								fieldName: sFieldName,
								inputContext: oInputContext,
								selectedOptionKey: oSelectedItem ? oSelectedItem.getKey() : oComboBox.getValue(),
								selectedCustomOptionItem: oSelectedItem && oSelectedItem.data("semantic") ? sap.ui.getCore().byId(oSelectedItem.getBindingContext(
										"viewModel")
									.getProperty("id")) : null
							}, true);
						} catch (e) {}

						that._oViewModel.setProperty("previousSelectedKey", oSelectedItem ? oSelectedItem.getKey() : "", oViewModelContext);

						if (bContinue === false) {
							// event handler decided that default processing should be skipped
							return;
						}

						switch (oSelectedItem ? oSelectedItem.getKey() : "") {
						case "_BLANK":
							that._oModel.setProperty(oInputContext.getPath() + oViewModelContext.getPath(), "");
							that._recalculateDependentLabels(sFieldName);
							break;
						case "_SELECT":
							oViewModel.setProperty("isSingleMode", true, oViewModelContext);

							var oDatePicker, oInput = oSmartControl.getInnerControls().filter(function (oElement) {
								return oElement instanceof sap.m.Input;
							})[0];
							if (!oInput) {
								oDatePicker = oSmartControl.getInnerControls().filter(function (oElement) {
									return oElement instanceof sap.m.DatePicker;
								})[0];
							}

							// Special handling - date field
							if (!oInput && oDatePicker) {
								oDatePicker.attachEventOnce("change", function () {
									that._raiseEventAfterNewValueSelected(sFieldName, oDatePicker.getValue());
									that._processParametersForMassEdit(oInputContext, oViewModel);
									oViewModel.setProperty("isSingleMode", false, oViewModelContext);
									oComboBox.focus();
								}, that);
								return;
							}

							oInput.fireValueHelpRequest({
								fromSuggestions: false
							});

							var bValueHelpCancelled = true;
							oSmartControl.attachEventOnce("valueListChanged", function (oEvent) {
								bValueHelpCancelled = false;
							});

							var mDelegatedEvents = {
								onfocusin: function () {
									oInput.removeEventDelegate(mDelegatedEvents, that);
									// if user cancels the value help dialog, the previous CONCRETE value will remain in the SmartField.
									// if the previous value was not concrete, value will be empty. in this case we will fall back to whatever option was selected last
									var sInputValue = oInput.getValue();
									if (sInputValue) {
										that._raiseEventAfterNewValueSelected(sFieldName, oInput.getValue());
										that._processParametersForMassEdit(oInputContext, oViewModel);
									} else if (!bValueHelpCancelled) {
										// empty value selected
										that._setNewValueManually(sFieldName, "_BLANK");
									} else {
										that._setNewValueManually(sFieldName, sPreviousKey);
									}
									oViewModel.setProperty("isSingleMode", false, oViewModelContext);
									oComboBox.focus();
								}
							};
							oInput.addEventDelegate(mDelegatedEvents, that);
							break;
						default:
							var sValue = oComboBox.getValue();

							if (sValue.indexOf("\u200c") === 0) {
								// Detected that user has messed with one of our strings _BLANK / _KEEP / _SELECT
								sValue = "";
							}

							that._oModel.setProperty(oInputContext.getPath() + oViewModelContext.getPath(),
								oSelectedItem ? oSelectedItem.getBindingContext("viewModel").getProperty("originalValue") : sValue);
							that._recalculateDependentLabels(sFieldName);
							that._processParametersForMassEdit(oInputContext, oViewModel);
						}
					}
				}))());

				if (oViewModel && oViewModel.getProperty("/isMassEdit") === true) {
					oViewModel.setProperty("/isMassEdit", false);
					oDialog.attachEventOnce("afterOpen", jQuery.proxy(oViewModel.setProperty, oViewModel, "/isMassEdit", true));
				}

				oExtensionAPI.attachToView(oDialog);

				if (oContext) {
					oDialog.setBindingContext(oContext);
				}

				if (oViewModel) {
					oDialog.setModel(oViewModel, "viewModel");
				}

				try {
					that.fireEvent("beforeDialogOpens", {
						dialog: oDialog
					});
				} catch (e) {}
				oDialog.open();
				that._oDialog = oDialog;

				var aSmartFormGroupElements = fnFindAllControlsByType(that._oDialog, sap.ui.comp.smartform.GroupElement.prototype.constructor);
				aSmartFormGroupElements
					.forEach(function (oFormGroupElement) {
						var oViewModelContext = oFormGroupElement.getBindingContext("viewModel");
						if (oViewModelContext && oViewModelContext.getProperty("dataType") === "Edm.DateTime") {
							fnFindAllControlsByType(oFormGroupElement, sap.m.ComboBox.prototype.constructor).some(function (oComboBox) {
								that._oViewModel.setProperty("parsedValue", oComboBox.getValue(), oViewModelContext);
								oComboBox.bindValue({
									path: "viewModel>parsedValue",
									type: new _DateType(oViewModelContext)
								});
								return true;
							});
						}
					});
			});
		},

		_setNewValueManually: function (sFieldName, sKey) {
			var oInputContext = this._oViewModel.createBindingContext("/" + sFieldName);
			this._oViewModel.setProperty("selectedKey", sKey, oInputContext);

			var mNewValue = oInputContext.getProperty("massEditValues").filter(function (mData) {
					return mData.key === sKey;
				})[0],
				oSelectedItem = sap.ui.getCore().byId(mNewValue.id);

			try {
				this.fireEvent("valueOptionSelected", {
					isKeep: oSelectedItem && oSelectedItem.data("semantic") === "KeepValue",
					isLeaveBlank: oSelectedItem && oSelectedItem.data("semantic") === "LeaveBlank",
					isConcreteValue: oSelectedItem && oSelectedItem.data("semantic") === "ConcreteValue",
					isCustomOption: oSelectedItem && oSelectedItem.data("semantic") === "Custom",
					fieldName: sFieldName,
					inputContext: oInputContext,
					selectedOptionKey: oSelectedItem ? oSelectedItem.getKey() : "",
					selectedCustomOptionItem: oSelectedItem
				}, true);
			} catch (e) {}
		},

		_raiseEventAfterNewValueSelected: function (sFieldName, sValue) {
			// cancelling event has no effect here
			try {
				this.fireEvent("valueOptionSelected", {
					isFirstTime: false,
					isKeep: false,
					isLeaveBlank: false,
					isConcreteValue: true,
					isCustomOption: false,
					fieldName: sFieldName,
					selectedOptionKey: sValue,
					selectedCustomOptionItem: null
				}, true);
			} catch (e) {}
		},

		_proposeParameters: function (aSelectedContexts, oInputContext, mParameterMap, bReturnValues) {
			var fnDateSorter = function (dA, dB) {
					return dA - dB;
				},
				fnGetDateComparer = function (vValue1) {
					return function (vValue2) {
						return vValue2 && vValue1 && vValue2.getTime() === vValue1.getTime();
					};
				},
				aFieldNames = this._aFields.concat(this._aDependentFields),
				mAllParameters = aFieldNames.reduce(function (mMap, sFieldName) {
					if (!mMap[sFieldName]) {
						mMap[sFieldName] = sFieldName;
					}
					return mMap;
				}, mParameterMap || {}),
				mFirstContextData = aSelectedContexts[0].getObject(),
				mAllValues = bReturnValues ? aFieldNames.reduce(function (mMap, sFieldName) {
					mMap[sFieldName] = [mFirstContextData[mAllParameters[sFieldName]]];
					return mMap;
				}, {}) : {};

			// start with second context
			for (var i = 1; i < aSelectedContexts.length; i++) {
				if (bReturnValues) {
					for (var k in mAllValues) {
						var bIsDate;
						if (mAllValues.hasOwnProperty(k)) {
							var sValue = aSelectedContexts[i].getProperty(mAllParameters[k]);
							bIsDate = bIsDate || sValue instanceof Date;
							if ((!bIsDate && mAllValues[k].indexOf(sValue) === -1) || (bIsDate && !mAllValues[k].some(fnGetDateComparer(sValue)))) {
								// discovered a new value
								mAllValues[k].push(sValue);
								if (mAllValues[k].length === 2) {
									aFieldNames.splice(aFieldNames.indexOf(k), 1);
								}
							}
						}
						if (bIsDate) {
							mAllValues[k].sort(fnDateSorter);
						} else {
							mAllValues[k].sort();
						}
						bIsDate = false;
					}
				} else {
					aFieldNames = jQuery.map(aFieldNames, function (sField) {
						return aSelectedContexts[i].getProperty(mAllParameters[sField]) === mFirstContextData[mAllParameters[sField]] ? sField :
							null;
					});
				}
			}

			// now we have all fields which are the same across all context instances
			for (i = 0; i < aFieldNames.length; i++) {
				if (!mFirstContextData[mAllParameters[aFieldNames[i]]]) {
					continue;
				}
				oInputContext.getModel().setProperty(oInputContext.getPath() + "/" + aFieldNames[i], mFirstContextData[mAllParameters[
					aFieldNames[
						i]]]);
			}

			return bReturnValues ? mAllValues : undefined;
		},

		_proposeParametersForMassEdit: function (oParentView, aSelectedContexts, oInputContext, mParameterMap) {
			var oI18nModel = oParentView.getModel("@i18n"),
				oMetaModel = this._oModel.getMetaModel(),
				oInputContextType = this._oEntityType, //MetaModel.getODataEntityType(oInputContext.getObject().__metadata.type),
				mAllValues = this._proposeParameters(aSelectedContexts, oInputContext, mParameterMap || {}, true),
				mTopOptions = [{
					key: "_BLANK",
					value: "\u200c" + oI18nModel.getProperty("xlst.leaveBlank"),
					semantic: "LeaveBlank"
				}, {
					key: "_KEEP",
					value: "\u200c" + oI18nModel.getProperty("xlst.keepExistingValues"),
					semantic: "KeepValue"
				}, {
					key: "_SELECT",
					value: "\u200c" + oI18nModel.getProperty("xlst.useValueHelp"),
					semantic: "SelectValue"
				}],
				mViewData = {},
				oResult = {
					isMassEdit: aSelectedContexts.length > 1
				};

			for (var k in mAllValues) {
				// if .length === 1, then we know they're all the same
				//		then, if first value is empty string, then we know it's < Leave Blank >
				// else: < Keep Existing Value >
				if (mAllValues.hasOwnProperty(k) && this._aDependentFields.indexOf(k) === -1) {
					var bHasBlankValues = false;

					if (!oResult.isMassEdit) {
						oResult[k] = {
							isSingleMode: true
						};
						continue;
					}

					mViewData[k] = jQuery.extend([], mTopOptions);
					if (mAllValues[k].length > 1 || (mAllValues[k][0] !== "" && mAllValues[k][0] !== null && mAllValues[k][0] !== "0" && mAllValues[
								k]
							[0] !== undefined)) {
						mViewData[k] = mViewData[k].concat(mAllValues[k].reduce(function (aValues, sValue) {
							if (!sValue || sValue === "0") {
								// Don't offer the "blank" value as option
								// bHasBlankValues indicates that in the set of possible options, "blank" values were found
								// As these values are filtered, the length>4 check further down would be distorted
								// During this reduction operation, we already know we have more than one distinct value (see above .length>1)
								bHasBlankValues = true;
								return aValues;
							}

							return aValues.concat({
								key: sValue.toString(),
								originalValue: sValue,
								value: this._formatLabel(sValue, k),
								semantic: "ConcreteValue"
							});
						}.bind(this), []));
					} else {
						// else it's blank, and will fall to _BLANK. Remove _KEEP option as per UX guideline
						// bHasBlankValues is not set. All entities have in common that they're blank; therefore no values are offered
						mViewData[k].splice(1, 1);
					}
					oResult[k] = {
						isSingleMode: false,
						sourceFieldName: mParameterMap ? mParameterMap[k] || k : k,
						// >4 because first 3 are _KEEP, _BLANK, _SELECT and one from the value set
						selectedKey: bHasBlankValues || mViewData[k].length > 4 ? "_KEEP" : mAllValues[k][0] || "_BLANK",
						massEditValues: mViewData[k]
					};

					if (oResult[k].selectedKey === "0") {
						oResult[k].selectedKey = "_BLANK";
					}

					oResult[k].previousSelectedKey = oResult[k].selectedKey;

					var oProperty = oMetaModel.getODataProperty(oInputContextType, k);
					oResult[k].dataType = oProperty && oProperty.type ? oProperty.type : "Edm.String";
					if (!oProperty || (!oProperty["com.sap.vocabularies.Common.v1.ValueList"] && oProperty.type !== "Edm.DateTime")) {
						// no value help is defined- remove _SELECT option. it's either second or third in the array.
						// DateTime fields don't have a "value help" but a date selector!
						oResult[k].massEditValues.splice(oResult[k].massEditValues[1].key === "_SELECT" ? 1 : 2, 1);
					}
					if (oProperty && oProperty.type === "Edm.DateTime") {
						// do some label replacements as per guideline
						// as we are deviating from the standard strings, need to do some cloning at the same time
						if (oResult[k].selectedKey !== "_BLANK") {
							// this option only exists if at least one record is 'not initial'
							oResult[k].massEditValues[1] = jQuery.extend({}, oResult[k].massEditValues[1], {
								value: "\u200c" + oI18nModel.getProperty("xlst.keepExistingDates")
							});
							oResult[k].massEditValues[2] = jQuery.extend({}, oResult[k].massEditValues[2], {
								value: "\u200c" + oI18nModel.getProperty("xlst.selectNewDate")
							});
						} else {
							oResult[k].massEditValues[1] = jQuery.extend({}, oResult[k].massEditValues[1], {
								value: "\u200c" + oI18nModel.getProperty("xlst.selectNewDate")
							});
						}
					}
					if (oProperty && oProperty["com.sap.vocabularies.Common.v1.FieldControl"] && jQuery.sap.endsWith(oProperty[
							"com.sap.vocabularies.Common.v1.FieldControl"].EnumMember, "Mandatory")) {
						// field is mandatory and therefore may not be left blank- remove _BLANK option
						oResult[k].massEditValues.splice(0, 1);
					}
				}
			}

			return oResult;
		},

		_formatLabel: function (vValue, sFieldName) {
			if (vValue instanceof Date) {
				return sap.ui.core.format.DateFormat.getDateInstance().format(vValue);
			}

			if (this._oEntityType && sFieldName) {
				// case a: value from value help- value help should have loaded the text
				// the value help would have also updated the dependent fields (e.g. planning plant).
				var oMetaModel = this._oModel.getMetaModel(),
					oFieldMetadata = oMetaModel.getODataProperty(this._oEntityType, sFieldName),
					sText;

				if (oFieldMetadata && oFieldMetadata["com.sap.vocabularies.Common.v1.ValueList"]) {
					var mValueList = oFieldMetadata["com.sap.vocabularies.Common.v1.ValueList"],
						oValueListEntityType = oMetaModel.getODataEntityType(oMetaModel.getODataEntitySet(mValueList.CollectionPath.String).entityType),
						oValueListFieldMetadata;
					var sKey = this._oModel.createKey("/" + mValueList.CollectionPath.String, mValueList.Parameters.reduce(function (mKey,
						mValueListParameter) {
						if (mValueListParameter.RecordType.indexOf("ValueListParameterIn") !== -1) {
							if (mValueListParameter.LocalDataProperty.PropertyPath === sFieldName) {
								mKey[mValueListParameter.ValueListProperty.String] = vValue;
								oValueListFieldMetadata = oMetaModel.getODataProperty(oValueListEntityType, mValueListParameter.ValueListProperty.String);
							} else {
								mKey[mValueListParameter.ValueListProperty.String] = this._oParameterContext.getProperty(mValueListParameter.LocalDataProperty
									.PropertyPath);
								this._registerFieldDependency(mValueListParameter.LocalDataProperty.PropertyPath, sFieldName);
							}
						}
						return mKey;
					}.bind(this), {}));
					if (oValueListFieldMetadata && oValueListFieldMetadata["com.sap.vocabularies.Common.v1.Text"] && oValueListFieldMetadata[
							"com.sap.vocabularies.Common.v1.Text"].Path) {
						sText = this._oModel.getProperty(sKey + "/" +
							oValueListFieldMetadata["com.sap.vocabularies.Common.v1.Text"].Path);
					}

					if (!sText) {
						// case b: value found in original entity
						// if dependent keys are involved, reading the text will only occur if all dependent keys are set in the parameter context. this will only be the case if all selected contexts share the same dependent key values!
						var mAllEntities = this._oModel.getProperty("/"),
							mLocalKeys = mValueList.Parameters.reduce(function (mKey, mValueListParameter) {
								if (mValueListParameter.RecordType.indexOf("ValueListParameterIn") !== -1) {
									if (mValueListParameter.LocalDataProperty.PropertyPath === sFieldName) {
										mKey[mValueListParameter.LocalDataProperty.PropertyPath] = vValue;
									} else {
										mKey[mValueListParameter.LocalDataProperty.PropertyPath] = this._oParameterContext.getProperty(mValueListParameter.LocalDataProperty
											.PropertyPath);
										this._registerFieldDependency(mValueListParameter.LocalDataProperty.PropertyPath, sFieldName);
									}
								}
								return mKey;
							}.bind(this), {});

						if (oFieldMetadata["com.sap.vocabularies.Common.v1.Text"] && oFieldMetadata["com.sap.vocabularies.Common.v1.Text"].Path &&
							Object.values(mLocalKeys).indexOf(null) === -1) {
							for (var k in mAllEntities) {
								if (mAllEntities.hasOwnProperty(k)) {
									var mEntity = mAllEntities[k];
									if (!mEntity.__metadata || mEntity.__metadata.type.indexOf(this._oEntityType.name) === -1) {
										// wrong entity
										continue;
									}

									var bFound = true;
									for (var j in mLocalKeys) {
										if (mLocalKeys.hasOwnProperty(j)) {
											if (mEntity[j] !== mLocalKeys[j]) {
												bFound = false;
												break;
											}
										}
									}
									if (bFound) {
										sText = this._oModel.getProperty("/" + mEntity.__metadata.id.split("/").pop() + "/" + oFieldMetadata[
											"com.sap.vocabularies.Common.v1.Text"].Path);
										break;
									}
								}
							}
						}
					}
				}
				if (sText) {
					return sText + " (" + vValue + ")";
				}
			}

			return vValue;
		},

		_registerFieldDependency: function (sSourceFieldName, sTargetFieldName) {
			if (this._mFieldDependencies[sSourceFieldName] && this._mFieldDependencies[sSourceFieldName].indexOf(sTargetFieldName) === -1) {
				this._mFieldDependencies[sSourceFieldName].push(sTargetFieldName);
			}
		},

		_recalculateDependentLabels: function (sFieldName) {
			if (!this._mFieldDependencies[sFieldName]) {
				return;
			}

			this._mFieldDependencies[sFieldName].forEach(function (sDependentFieldName) {
				var aAllValues = this._oViewModel.getProperty("/" + sDependentFieldName + "/massEditValues");
				aAllValues.forEach(function (mValue) {
					if (mValue.semantic === "ConcreteValue") {
						mValue.value = this._formatLabel(mValue.originalValue, sDependentFieldName);
					}
				}.bind(this));
				this._oViewModel.setProperty("/" + sDependentFieldName + "/massEditValues", aAllValues);
			}.bind(this));
		},

		_processParametersForMassEdit: function (oInputContext, oViewModel, sFieldName) {
			var mParameters = oInputContext.getObject(),
				mViewData = oViewModel.getProperty("/");

			for (var k in mParameters) {
				if (!mViewData[k] || !mViewData[k].massEditValues || (sFieldName && sFieldName !== k)) {
					continue;
				}

				if ((["_KEEP", "_BLANK"].indexOf(mViewData[k].selectedKey) !== -1 && mParameters[k]) || (mParameters[k] && mParameters[k] !==
						mViewData[k].selectedKey)) {
					mViewData[k].selectedKey = mParameters[k];

					if (!mViewData[k].massEditValues.some(function (mItem) {
							return mItem.key === (mParameters[k] ? mParameters[k].toString() : mParameters[k]);
						})) {
						mViewData[k].massEditValues = mViewData[k].massEditValues.filter(function (mItem) {
							return mItem.isTemporary !== true;
						});
						mViewData[k].massEditValues.push({
							key: mParameters[k].toString(),
							originalValue: mParameters[k],
							value: this._formatLabel(mParameters[k], k),
							isTemporary: true,
							semantic: "ConcreteValue"
						});
					}

					oViewModel.setProperty("/" + k + "/", mViewData[k]);
				} else if (mViewData[k].selectedKey === "") {
					// set it back to _BLANK or _KEEP, whatever is available:
					mViewData[k].selectedKey = mViewData[k].massEditValues[0].key;
					oViewModel.setProperty("/" + k + "/", mViewData[k]);
				}
			}
		},

		_getParametersForSubmit: function (oContext) {
			var mParameters = oContext.getObject(),
				mViewModel = this._oViewModel.getProperty("/");
			Object.keys(mParameters).forEach(function (sKey, iIndex) {
				if (sKey.substring(0, 1) === "_") {
					delete mParameters[sKey];
				} else if (mViewModel[sKey] && typeof mViewModel[sKey].parsedValue !== "undefined" && mViewModel[sKey].parsedValue instanceof Date) {
					mParameters[sKey] = mViewModel[sKey].parsedValue;
				}
			});
			return mParameters;
		},

		_splitActionInvocationForMassEdit: function (aContextsIn, sAction, mParameters, mMassEditParameters, oExtensionAPI) {
			var aContexts = aContextsIn.slice(0),
				oPromise = Promise.resolve(),
				fnCompileParameters = function (oContext) {
					var mContextParameters = this._aFields.reduce(function (mMap, sFieldName) {
						mMap[sFieldName] = mParameters[sFieldName];
						return mMap;
					}, {});
					for (var k in mMassEditParameters) {
						if (mMassEditParameters[k].selectedKey === "_KEEP") {
							mContextParameters[k] = oContext.getProperty(mMassEditParameters[k].sourceFieldName);
						}
						if (mMassEditParameters[k].selectedKey === "_BLANK" || /* blank in single mode: */ mContextParameters[k] === null) {
							delete mContextParameters[k];
						}
					}
					return mContextParameters;
				}.bind(this);

			for (var i = 0; i < aContexts.length; i++) {
				if (aContexts[i] === null) {
					continue;
				}

				var aCandidate = [aContexts[i]],
					mMyParameters = fnCompileParameters(aContexts[i], mParameters, mMassEditParameters);

				for (var j = i + 1; j < aContexts.length; j++) {
					if (aContexts[j] === null) {
						// candidate was already processed
						continue;
					}

					var mForCompare = fnCompileParameters(aContexts[j], mParameters, mMassEditParameters);
					if (jQuery.sap.equal(mMyParameters, mForCompare)) {
						aCandidate.push(aContexts[j]);
						aContexts[j] = null;
					}
				}

				// Same parameter tuple can go into one $batch, but not in same changeset (yet)
				// Different parameter tuples need to be submitted one after the other; otherwise the changesets will end up being merged!
				// This is probably a shortcoming of ApplicationControllers#invokeActions()
				oPromise = oPromise.then(jQuery.proxy(oExtensionAPI.invokeActions, oExtensionAPI,
					"EAM_OBJPG_MAINTENANCEORDER_SRV.EAM_OBJPG_MAINTENANCEORDER_SRV_Entities/" + sAction,
					aCandidate, mMyParameters)).catch(jQuery.noop);
			}

			return oPromise;
		},

		_prepareModel: function () {
			if (this._oModel.getDeferredGroups().indexOf("BreakoutActionParameters") !== -1) {
				return;
			}

			var aGroupIds = this._oModel.getDeferredGroups();
			aGroupIds.push("BreakoutActionParameters");
			this._oModel.setDeferredGroups(aGroupIds);
		}

	});
});