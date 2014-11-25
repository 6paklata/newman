var jsface       = require('jsface'),
	Globals      = require('./Globals'),
	log          = require('./Logger'),
	_und         = require('underscore'),
	ResultSummary= require('../models/ResultSummaryModel'),
	path         = require('path'),
	fs           = require('fs');

/**
 * @class ResponseExporter
 * @classdesc Class Used for exporting the generated responses.
 */
var ResponseExporter = jsface.Class({
	$singleton: true,

	_results: [],

	//each element will be an object of type: {type:coll/folder, parentId, parentName, passCount, failCount}
	_summaryResults: [],

	/**
	 * Adds the Reponse to the Result Array.
	 * @param {Object} request Request we got from Newman.
	 * @param {Object} response Response we got from Newman.
	 * @param {Object} tests Test Results.
	 * @memberOf ResponseExporter
	 */
	addResult: function(request, response, tests) {
		var result = this._findResultObject(request);
		if (result) {
			this._appendToResultsObject(result, request, response, tests);
		} else {
			result = this._createResultObject(request, response, tests);
			this._results.push(result);
		}
		this.summarizeResults(request, tests);
	},

	summarizeResults: function(request, tests) {
		var passFailCount = this._getPassFailCount(tests);
		this._addPassFailCountToCollection(request, passFailCount);
		this._addPassFailCountToFolder(request, passFailCount);
		this._addPassFailCountToTotal(request, passFailCount);
	},

	_getPassFailCount: function(tests) {
		var vals = _und.values(tests);
		var total = vals.length;
		var passes = _und.filter(vals, function(val) {
			return val===true;
		});
		return {
			pass: passes.length,
			fail: total - passes.length
		};
	},

	_addPassFailCountToTotal: function(request, results) {
		var existingModel = _und.find(this._summaryResults, function(summaryResult) {
			return (summaryResult.type === "total");
		});
		if(!existingModel) {
			var newModel = new ResultSummary({
				type: 'total',
				parentId: null,
				parentName: "",
				passCount: results.pass,
				failCount: results.fail
			});
			this._summaryResults.push(newModel);
		}
		else {
			existingModel.passCount = existingModel.passCount + results.pass;
			existingModel.failCount = existingModel.failCount + results.fail;
		}
	},

	_addPassFailCountToCollection: function(request, results) {
		if(request.folderId && request.folderName) {
			return;
		}
		var existingModel = _und.find(this._summaryResults, function(summaryResult) {
			return (summaryResult.type === "collection" && summaryResult.parentId === request.collectionID);
		});
		if(!existingModel) {
			var newModel = new ResultSummary({
				type: 'collection',
				parentId: request.collectionID,
				parentName: request.collectionName,
				passCount: results.pass,
				failCount: results.fail
			});
			this._summaryResults.push(newModel);
		}
		else {
			existingModel.passCount = existingModel.passCount + results.pass;
			existingModel.failCount = existingModel.failCount + results.fail;
		}
	},

	_addPassFailCountToFolder: function(request, results) {
		if(!request.folderId || !request.folderName) {
			return;
		}

		var existingModel = _und.find(this._summaryResults, function(summaryResult) {
			return (summaryResult.type === "folder" && summaryResult.parentId === request.folderId);
		});
		if(!existingModel) {
			var newModel = new ResultSummary({
				type: 'folder',
				parentId: request.folderId,
				parentName: request.folderName,
				passCount: results.pass,
				failCount: results.fail
			});
			this._summaryResults.push(newModel);
		}
		else {
			existingModel.passCount = existingModel.passCount + results.pass;
			existingModel.failCount = existingModel.failCount + results.fail;
		}
	},

	showIterationSummary: function() {
		var sortedSummaries = [], collectionSummary, totalSummary;
		_und.map(this._summaryResults, function(res) {
			if(res.type==='folder') {
				sortedSummaries.push(res);
			}
			else if(res.type==='collection') {
				collectionSummary = res;
			}
			else if(res.type==='total') {
				totalSummary = res;
			}
		});
		if(collectionSummary) {
			sortedSummaries.push(collectionSummary);
		}
		if(totalSummary) {
			sortedSummaries.push(totalSummary);
		}
		log.showIterationSummary(sortedSummaries);
		this._summaryResults = [];
	},

	// Used to create a first result object, to be used while exporting the results.
	_createResultObject: function(request, response, tests) {
		if (!tests) {
			tests = {};
		}

		return {
			"id": request.id,
			"name": request.name,
			"url": request.url,
			"totalTime": response.stats.timeTaken,
			"responseCode": {
				"code": response.statusCode,
				"name": "",       // TODO: Fill these guys later on
				"detail": ""
			},
			"tests": tests, //this is meaningless
			"testPassFailCounts": this._extractPassFailCountFromTests(tests),
			"times": [],			// Not sure what to do with this guy
			"allTests": [tests],
			"time": response.stats.timeTaken
		};
	},

	_findResultObject: function(request) {
		return _und.find(this._results, function(result) {
			return result.id === request.id;
		}) || null;
	},

	_appendToResultsObject: function(result, request, response, tests) {
		var newResultObject = this._createResultObject(request, response, tests);
		newResultObject.totalTime += result.totalTime;
		newResultObject.allTests = newResultObject.allTests.concat(result.allTests);
		this._results[this._results.indexOf(result)] = newResultObject;
	},

	// Creates a pass, fail object for a given test.
	_extractPassFailCountFromTests: function(tests) {
		return _und.reduce(_und.keys(tests), function(results, key) {
			results[key] = {
				pass: tests[key] ? 1 : 0,
				fail: tests[key] ? 0 : 1
			};
			return results;
		}, {});
	},

	/**
	 * This function when called creates a file with the JSON of the results.
	 * @memberOf ResponseExporter
	 */
	exportResults: function() {
		if (Globals.outputFile) {
			var exportVariable = this._createExportVariable();
			var filepath = path.resolve(Globals.outputFile);
			fs.writeFileSync(filepath , JSON.stringify(exportVariable, null, 4));
			log.note("\n\n Output Log: " + filepath + "\n");
		}

		if (Globals.testReportFile) {
			var outputpath = path.resolve(Globals.testReportFile);
			fs.writeFileSync(outputpath, this._createJunitXML());
			log.note("\n\nJunit XML file written to: " + outputpath + "\n");
		}
	},

	_aggregateTestResults: function(runs) {
		var retVal = {};
		_und.each(runs, function(run) {
			for(var testName in run) {
				if(run.hasOwnProperty(testName)) {
					if(retVal.hasOwnProperty(testName)) {
						if(run[testName]) {
							retVal[testName].successes++;
						}
						else {
							retVal[testName].failures++;
						}
					}
					else {
						if(run[testName]) {
							retVal[testName]={
								successes: 1, failures: 0
							};
						}
						else {
							retVal[testName]={
								successes: 0, failures: 1
							};
						}
					}
				}
			}
		});
		return retVal;
	},

	_createJunitXML: function() {
			var oldThis = this;
			var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
			xml += "<testsuites>\n";

			_und.each(this._results, function(suite) {
				//var testRequest = _und.find(Globals.requestJSON.requests, function(request) {
				//	return suite.id === request.id;
				//});
				var aggregateTestStats = oldThis._aggregateTestResults(suite.allTests);

				//var timeStamp = new Date(testRequest.time);
				var iterations = suite.allTests.length;

				var timeStamp = new Date();
				//var time = testRequest.time;
				var time = suite.time;
				var meanTime = (time/iterations).toFixed(2);
				var tests = Object.keys(suite.tests).length;

				xml += '\t<testsuite name="' + _und.escape(suite.name) + '" id="' +
					_und.escape(suite.id) + '" timestamp="' + timeStamp.toISOString() +
					'" time="' + meanTime + ' ms" totalTime="'+time+' ms" tests="' + tests + '" iterations="'+iterations+'">\n';

				_und.each(suite.testPassFailCounts, function(testcase, testcaseName) {
					var successes = aggregateTestStats[testcaseName].successes;
					var failures = aggregateTestStats[testcaseName].failures;
					xml += '\t\t<testcase name="' + _und.escape(testcaseName) + '" successes="'+successes+'" failures="' + failures + '" />\n';
				}, this);

				xml += "\t</testsuite>\n";
			}, this);

			xml += "</testsuites>\n";
			return xml;
	},

	_createExportVariable: function() {
		return {
			id: '',
			name: 'Default',
			timestamp: new Date().getTime(),
			collection_id: Globals.requestJSON.id,
			folder_id: 0,
			target_type: 'collection',
			environment_id: Globals.envJson.id,
			count: Globals.iterationNumber - 1,
			collection: Globals.requestJSON,
			folder: null,
			globals: Globals.globalJSON,
			results: this._results,
			environment: Globals.envJson,
			delay: 0,
			synced: Globals.requestJSON.synced
		};
	}
});

module.exports = ResponseExporter;
