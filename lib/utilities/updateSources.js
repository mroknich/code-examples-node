/**
 * @file
 * Update public/source files
 * @author DocuSign
 */

const path = require('path')
    , fs = require('fs')
    , moment = require('moment')
    , request = require('request-promise-native')
    , jwt = require('jsonwebtoken')
    , dsConfig = require('../../ds_configuration.js').config
    , sourceDirPath = path.resolve(__dirname, '../../public/source')
    , ghApiUrl = 'https://api.github.com/'
    , ghPreviewHeader = {Accept: 'application/vnd.github.machine-man-preview+json',
                  'User-Agent': dsConfig.ghUserAgent}

    ;

let ghTokenExpiration = null
  , ghAccessToken = null
  , tallyNoExamples = []
  ;

/**
 * Building a GitHub app  https://developer.github.com/apps/building-github-apps/
 *
 */

async function ghCheckToken () {
    // refresh/create the gh token as needed.
    let bufferMin = 5
      , noToken = !ghAccessToken || !ghTokenExpiration
      , now = moment()
      , needToken = noToken || moment(ghTokenExpiration).subtract(
            bufferMin, 'm').isBefore(now)
      ;

    if (noToken) {log('checkToken: Starting up--need a token')}
    if (needToken && !noToken) {log('checkToken: Replacing old token')}

    if (needToken) {
        await ghCreateToken()
    }
}

async function ghCreateToken() {
    // Get an accessToken for GitHub...
    // Step 1. Create a JWT token for GitHub
    const now =  moment()
        , iat = now.unix()
        , exp = now.add( (9 * 60) + 30, 's').unix()
        , ghJWT = jwt.sign({ iat: iat, exp: exp,
                iss: dsConfig.gitHubAppId  }, dsConfig.gitHubPrivateKey,
                { algorithm: 'RS256'})
        , ghInstallationId = dsConfig.gitHubInstallationId
        , url = `${ghApiUrl}app/installations/${ghInstallationId}/access_tokens`
        , headers = {Accept: 'application/vnd.github.machine-man-preview+json',
                     'User-Agent': dsConfig.ghUserAgent}
        , rawResults = await ghApi (url, headers, ghJWT, 'POST')
        , results = JSON.parse(rawResults)
        ;

    // Test the JWT:
    // const results = await ghApi(ghApiUrl + 'app', ghPreviewHeader, ghJWT);

    ghAccessToken = results.token;
    ghTokenExpiration = moment(results.expires_at);
    log("Received access token");
}

async function ghApi(url, headers, token = null, op = 'GET') {
    const authToken = token ? token : ghAccessToken;
    let result;
    try {
        result = await request({
            method: op,
            uri: url,
            headers: headers,
            auth: {bearer: authToken}
        });
        // log('Good response: ' + result);
        return result;
    } catch (e) {
        log ('GitHub API Error: ' + JSON.stringify(e, null, 4))
        return false;
    }
}

async function ghGetFile(owner, repo, path) {
    // Best way to download GitHub content: https://stackoverflow.com/a/49818900/64904
    // See https://developer.github.com/v3/repos/contents/
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
        , headers = {Accept: 'application/vnd.github.v3.raw',
                     'User-Agent': dsConfig.ghUserAgent}
        ;
    let results;
    results = await ghApi(url, headers);
    return results;
}

function deleteSourceDir() {
    // Delete all files except for .gitkeep
    // See https://stackoverflow.com/a/42182416/64904
    const directory = sourceDirPath
        , gitkeep = '.gitkeep'
        , files = fs.readdirSync(directory);

    for (const file of files) {
        if (file == gitkeep) {
            continue;
        }
        fs.unlinkSync(path.join(directory, file));
    }
}

async function doLang(item, msg) {
    let fileNames = dsConfig.docNames[item.langCode],
        count = 0;
    for (var eg in fileNames) {
        count ++;
        exactLog(msg + count);
        const fileName = fileNames[eg];
        await process (item, fileName);
    }
    return count;
}

async function process(item, fileName){
    // Fetch and process the file
    let contents = await ghGetFile(item.owner, item.repo, item.pathPrefix + fileName);
    if (!contents) {
        // Wait and try one more time
        log ("\n\n*** Retrying the file fetch in 5 seconds...\n");
        const timeThen = new Date();
        while ((new Date.now()) - timeThen < 5000) { /* pause */ }
        contents = await ghGetFile(item.owner, item.repo, item.pathPrefix + fileName);
    }
    results = findExample(contents);
    if (!results.foundEg) {
        tallyNoExamples.push(fileName)
    }
    fs.appendFileSync(`${sourceDirPath}/${fileName}`, results.data, {flag: 'wx'});
}

function findExample (in) {
    // Return just the example from within the file.
    // If no markers then return entire file
    const start = "***DS.snippet.0.start",
          end   = "***DS.snippet.n.end";
    let out = [],
        foundStart = false;

    in = in.split("\n");
    in.forEach((line, index) => {
        const foundEnd = foundStart && line.indexOf(end) > -1;
        if (foundStart && foundEnd) {
            // all done
            break
        } else if (foundStart) {
            // In the middle
            out.push(line)
            continue;
        } else if (!foundStart && line.indexOf(start) > -1) {
            // found start
            foundStart = true;
            continue;
        }
    });

    if (foundStart) {
        // return just the example
        return {data: out.join("\n"), foundEg: foundStart}
    } else {
        // Never found the example
        return {data: in.join("\n"), foundEg: foundStart}
    }
}


function log(s) {
    console.log(s)
}
function exactLog(s) {
    process.stdout.write(s + "\r")
}



async function start() {
    await ghCheckToken();
    deleteSourceDir();
    log ("\n");
    for (const item of dsConfig.docOptions) {
        const msg  = `${item.name} examples: `;
        const completed = await doLang(item, msg);
        log (`\n${msg}completed ${completed}`);
    };

    log (`\nFiles which did not include the example markers:\n${tallyNoExamples.join("\n")}\n`);

    //let results = await ghGetFile('docusign', 'eg-03-php-auth-code-grant',
    //    'src/EG001EmbeddedSigning.php');
    //log ("\nFile results:\n" + results + "\n\n");
    log ("\nDone\n");
}



start();