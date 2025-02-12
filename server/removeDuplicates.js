/* script that runs periodically, and which goes through entries of database
   and checks for entries' duplicates. It does it by checking if photos are exactly the same
   even if they have different names. If two entries have exactly the same photos (same file JPG data content),
   and if they are from the same user, the older entry is considered a duplicate and it is marked as deleted */

/* eslint prefer-const: "off" */
/* eslint no-var: "off" */

const fs = require('fs')
const path = require('path')
const async = require('async')
const mysql = require('mysql') // module to get info from database
const debug = require('debug')('removeDuplicates')
const sqlFormatter = require('sql-formatter')

var imgDirectory // directory where the images are stored with respect to present file
var DBInfo
var dBPoolConnections // database connection variable

module.exports.init = (data) => {
  imgDirectory = data.imgDirectory
  DBInfo = data.DBInfo
  dBPoolConnections = data.dBPoolConnections

  removeDuplicates()
  setInterval(removeDuplicates, 1000 * 60 * 70) // every 70 minutes
}

// goes through the db and find inexistanf images, if so, delete them
function removeDuplicates () {
  // get all production entries grouped by uuid and then for each uuid ordered by date
  var query = `SELECT * FROM ${DBInfo.db_tables.ocorrencias} WHERE PROD=1 ` +
    `ORDER BY ${DBInfo.db_tables.ocorrencias}.uuid  ASC, ${DBInfo.db_tables.ocorrencias}.data_data ASC`

  debug(sqlFormatter.format(query))

  dBPoolConnections.query(query, (err, results, fields) => {
    if (err) {
      // error handling code goes here
      console.error('removeDuplicates: Error connecting or querying to database: ', err)
    } else {
      // debug('Result from db query is : ', results)
      const entriesToBeDeleted = getEntriesToBeDeleted(results) // array
      debug(`${entriesToBeDeleted.length} considered repeated and marked to be deleted`)

      async.each(entriesToBeDeleted, deleteEntry, (err) => {
        if (err) {
          console.error('removeDuplicates: An error occurred:', err)
        } else {
          debug('All entriesToBeDeleted processed successfully')
        }
      })
    }
  })
}

// repeated entries normally are inserted consecutively in the database
// that is, when an user submits twice the same entry
function getEntriesToBeDeleted (results) {
  var output = []
  // due to the mysql query, results are already grouped by (device) uuid, and then ordered by date
  for (var i = 1; i < results.length; i++) {
    // previous entry
    const previousA = results[i - 1].data_hora
    const previousB = results[i - 1].data_freguesia
    const previousC = results[i - 1].uuid
    const previousD = results[i - 1].anomaly_code
    const previousPhotos = [results[i - 1].foto1, results[i - 1].foto2, results[i - 1].foto3, results[i - 1].foto4]
    // current entry
    const currentA = results[i].data_hora
    const currentB = results[i].data_freguesia
    const currentC = results[i].uuid
    const currentD = results[i].anomaly_code
    const currentPhotos = [results[i].foto1, results[i].foto2, results[i].foto3, results[i].foto4]

    if (previousA === currentA &&
        previousB === currentB &&
        previousC === currentC &&
        previousD === currentD) {
      // check if photo1 is the same
      if (fs.existsSync(previousPhotos[0]) && fs.existsSync(currentPhotos[0]) &&
          areTwoPhotosEqual(previousPhotos[0], currentPhotos[0])) {
        output.push(results[i - 1])
      }
    }
  }

  return output
}

// check if two photos are equal (have same jpg content)
function areTwoPhotosEqual (photoA, photoB) {
  if (photoA && photoB) {
    var photoABuffer = fs.readFileSync(path.join(imgDirectory, photoA))
    var photoBBuffer = fs.readFileSync(path.join(imgDirectory, photoB))
    return photoABuffer.equals(photoBBuffer)
  } else {
    return false
  }
}

function deleteEntry (entry, callback) {
  debug('Entry is to be marked as deleted by system: ', entry)

  const query = `UPDATE ${DBInfo.database}.${DBInfo.db_tables.ocorrencias} ` +
    `SET ${mysql.escape({ deleted_by_sys: 1 })} ` +
    `WHERE table_row_uuid='${entry.table_row_uuid}'`
  debug(sqlFormatter.format(query))

  dBPoolConnections.query(query, (err, results, fields) => {
    if (err) {
      // error handling code goes here
      console.error('removeDuplicates: Error marking entry as deleted by system: ', err)
      callback(Error(err))
    } else {
      debug('Entry in database marked as deleted')
      // delete files from server corresponding to entry
      const photoArray = [entry.foto1, entry.foto2, entry.foto3, entry.foto4]
      for (var i = 0; i < photoArray.length; i++) {
        if (photoArray[i]) {
          const filePath = path.join(imgDirectory, photoArray[i])
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Could not delete file ${filePath}`)
            } else {
              debug(`File deleted successfully: ${filePath}`)
            }
          })
        }
      }
      callback()
    }
  })
}
