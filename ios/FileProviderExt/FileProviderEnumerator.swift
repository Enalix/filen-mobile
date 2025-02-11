//
//  FileProviderEnumerator.swift
//  FileProviderExt
//
//  Created by Jan Lenczyk on 30.09.23.
//

import FileProvider
import Alamofire

class FileProviderEnumerator: NSObject, NSFileProviderEnumerator {
  private let identifier: NSFileProviderItemIdentifier
  private let uploadsRangeData = "\"data\":{\"uploads\":[".data(using: .utf8)!
  private let foldersRangeData = "],\"folders\":[".data(using: .utf8)!
  private let closingRangeData = "}".data(using: .utf8)!
  private let openingRangeData = "{".data(using: .utf8)!
  private let commaData = ",".data(using: .utf8)!
  private let endData = "]}}".data(using: .utf8)!
      
  init (identifier: NSFileProviderItemIdentifier) {
    self.identifier = identifier
    
    super.init()
  }

  func invalidate() {
    // Noop
  }
  
  func processFolder (folder: FetchFolderContentsFolder, masterKeys: [String]) throws -> FileProviderItem {
    try autoreleasepool {
      var decryptedName: FolderMetadata?
      
      if let row = try FileProviderUtils.shared.openDb().run("SELECT name FROM decrypted_folder_metadata WHERE used_metadata = ?", [folder.name]).makeIterator().next() {
        if let name = row[0] as? String {
          decryptedName = FolderMetadata(name: name)
        }
      }
      
      if decryptedName == nil {
        if let decrypted = FilenCrypto.shared.decryptFolderName(metadata: folder.name, masterKeys: masterKeys) {
          decryptedName = FolderMetadata(name: decrypted)
          
          try FileProviderUtils.shared.openDb().run(
            "INSERT OR IGNORE INTO decrypted_folder_metadata (uuid, name, used_metadata) VALUES (?, ?, ?)",
            [
              folder.uuid,
              decrypted,
              folder.name
            ]
          )
        }
      }
      
      if let decryptedName = decryptedName {
        try FileProviderUtils.shared.openDb().run(
          "INSERT OR REPLACE INTO items (uuid, parent, name, type, mime, size, timestamp, lastModified, key, chunks, region, bucket, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            folder.uuid,
            folder.parent,
            decryptedName.name,
            "folder",
            "",
            0,
            folder.timestamp,
            folder.timestamp,
            "",
            0,
            "",
            "",
            0
          ]
        )
        
        return FileProviderItem(
          identifier: NSFileProviderItemIdentifier(folder.uuid),
          parentIdentifier: self.identifier,
          item: Item(
            uuid: folder.uuid,
            parent: folder.parent,
            name: decryptedName.name,
            type: .folder,
            mime: "",
            size: 0,
            timestamp: FilenUtils.shared.convertUnixTimestampToMs(folder.timestamp),
            lastModified: FilenUtils.shared.convertUnixTimestampToMs(folder.timestamp),
            key: "",
            chunks: 0,
            region: "",
            bucket: "",
            version: 0
          )
        )
      }
      
      return FileProviderItem(
        identifier: NSFileProviderItemIdentifier(folder.uuid),
        parentIdentifier: self.identifier,
        item: Item(
          uuid: folder.uuid,
          parent: folder.parent,
          name: "",
          type: .folder,
          mime: "",
          size: 0,
          timestamp: 0,
          lastModified: 0,
          key: "",
          chunks: 0,
          region: "",
          bucket: "",
          version: 0
        )
      )
    }
  }
  
  func processFile (file: FetchFolderContentsFile, masterKeys: [String]) throws -> FileProviderItem {
    try autoreleasepool {
      var decryptedMetadata: FileMetadata?
      
      if let row = try FileProviderUtils.shared.openDb().run("SELECT name, size, mime, key, lastModified FROM decrypted_file_metadata WHERE used_metadata = ?", [file.metadata]).makeIterator().next() {
        if let name = row[0] as? String, let size = row[1] as? Int64, let mime = row[2] as? String, let key = row[3] as? String, let lastModified = row[4] as? Int64 {
          decryptedMetadata = FileMetadata(
            name: name,
            size: Int(size),
            mime: mime,
            key: key,
            lastModified: Int(lastModified)
          )
        }
      }
      
      if decryptedMetadata == nil {
        if let decrypted = FilenCrypto.shared.decryptFileMetadata(metadata: file.metadata, masterKeys: masterKeys) {
          decryptedMetadata = FileMetadata(
            name: decrypted.name,
            size: decrypted.size ?? 0,
            mime: decrypted.mime ?? "",
            key: decrypted.key,
            lastModified: decrypted.lastModified ?? file.timestamp
          )
          
          try FileProviderUtils.shared.openDb().run(
            "INSERT OR IGNORE INTO decrypted_file_metadata (uuid, name, size, mime, key, lastModified, used_metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              file.uuid,
              decrypted.name,
              decrypted.size ?? 0,
              decrypted.mime ?? "",
              decrypted.key,
              decrypted.lastModified ?? file.timestamp,
              file.metadata
            ]
          )
        }
      }
      
      if let decryptedMetadata = decryptedMetadata {
        try FileProviderUtils.shared.openDb().run(
          "INSERT OR REPLACE INTO items (uuid, parent, name, type, mime, size, timestamp, lastModified, key, chunks, region, bucket, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            file.uuid,
            file.parent,
            decryptedMetadata.name,
            "file",
            decryptedMetadata.mime ?? "",
            decryptedMetadata.size ?? 0,
            file.timestamp,
            decryptedMetadata.lastModified ?? file.timestamp,
            decryptedMetadata.key,
            file.chunks,
            file.region,
            file.bucket,
            file.version
          ]
        )
        
        return FileProviderItem(
          identifier: NSFileProviderItemIdentifier(file.uuid),
          parentIdentifier: self.identifier,
          item: Item(
            uuid: file.uuid,
            parent: file.parent,
            name: decryptedMetadata.name,
            type: .file,
            mime: decryptedMetadata.mime ?? "",
            size: decryptedMetadata.size ?? 0,
            timestamp: FilenUtils.shared.convertUnixTimestampToSec(file.timestamp),
            lastModified: FilenUtils.shared.convertUnixTimestampToSec(decryptedMetadata.lastModified ?? file.timestamp),
            key: decryptedMetadata.key,
            chunks: file.chunks,
            region: file.region,
            bucket: file.bucket,
            version: file.version
          )
        )
      }
      
      return FileProviderItem(
        identifier: NSFileProviderItemIdentifier(file.uuid),
        parentIdentifier: self.identifier,
        item: Item(
          uuid: file.uuid,
          parent: file.parent,
          name: "",
          type: .file,
          mime: "",
          size: 0,
          timestamp: 0,
          lastModified: 0,
          key: "",
          chunks: file.chunks,
          region: file.region,
          bucket: file.bucket,
          version: file.version
        )
      )
    }
  }

  func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
    Task {
      do {
        guard let rootFolderUUID = FileProviderUtils.shared.rootFolderUUID(), let masterKeys = FileProviderUtils.shared.masterKeys(), let apiKey = MMKVInstance.shared.instance?.string(forKey: "apiKey", defaultValue: nil), let url = URL(string: "https://gateway.filen.io/v3/dir/content") else {
          observer.finishEnumeratingWithError(NSFileProviderError(.notAuthenticated))
          
          return
        }
        
        let headers: HTTPHeaders = [
          "Authorization": "Bearer \(apiKey)",
          "Accept": "application/json",
          "Content-Type": "application/json"
        ]
        
        if FileProviderUtils.shared.needsFaceID() {
          observer.finishEnumeratingWithError(NSFileProviderError(.notAuthenticated))
          
          return
        }
        
        if (self.identifier == NSFileProviderItemIdentifier.rootContainer || self.identifier.rawValue == rootFolderUUID || self.identifier.rawValue == NSFileProviderItemIdentifier.rootContainer.rawValue) {
          try FileProviderUtils.shared.openDb().run(
            "INSERT OR REPLACE INTO items (uuid, parent, name, type, mime, size, timestamp, lastModified, key, chunks, region, bucket, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              rootFolderUUID,
              rootFolderUUID,
              "Cloud Drive",
              "folder",
              "",
              0,
              0,
              0,
              "",
              0,
              "",
              "",
              0
            ]
          )
          
          try FileProviderUtils.shared.openDb().run(
            "INSERT OR REPLACE INTO items (uuid, parent, name, type, mime, size, timestamp, lastModified, key, chunks, region, bucket, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              NSFileProviderItemIdentifier.rootContainer.rawValue,
              rootFolderUUID,
              "Cloud Drive",
              "folder",
              "",
              0,
              0,
              0,
              "",
              0,
              "",
              "",
              0
            ]
          )
        }
        
        let folderUUID = self.identifier == NSFileProviderItemIdentifier.rootContainer || self.identifier.rawValue == "root" || self.identifier.rawValue == NSFileProviderItemIdentifier.rootContainer.rawValue ? rootFolderUUID : self.identifier.rawValue
        let tempJSONFileURL = try await AF.download(url, method: .post, parameters: ["uuid": folderUUID], encoding: JSONEncoding.default, headers: headers){ $0.timeoutInterval = 3600 }.validate().serializingDownloadedFileURL().value
        
        defer {
          do {
            if FileManager.default.fileExists(atPath: tempJSONFileURL.path) {
              try FileManager.default.removeItem(atPath: tempJSONFileURL.path)
            }
          } catch {
            print("[enumerateItems] error:", error)
          }
        }
        
        guard let inputStream = InputStream(url: tempJSONFileURL) else {
          throw NSError(domain: "enumerateItems", code: 1, userInfo: nil)
        }
        
        inputStream.open()
        
        defer {
          inputStream.close()
        }
        
        let bufferSize = 1024
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        var accumulatedData = Data()
        var currentState: FetchFolderContentJSONParseState = .lookingForData
        var didParseFiles = false
        var didEnumerate = false

        while inputStream.hasBytesAvailable || accumulatedData.count > 0 {
          autoreleasepool {
            let bytesRead = inputStream.read(&buffer, maxLength: bufferSize)
            
            if bytesRead > 0 || accumulatedData.count > 0 {
              accumulatedData.append(contentsOf: buffer[0..<bytesRead])
                
              switch currentState {
              case .lookingForData:
                if let dataRange = accumulatedData.range(of: self.uploadsRangeData) {
                  accumulatedData.removeSubrange(0..<dataRange.endIndex)
                  currentState = .parsingData
                }
                
              case .parsingData:
                if let foldersRange = accumulatedData.range(of: self.foldersRangeData) {
                  accumulatedData.removeSubrange(foldersRange.startIndex..<foldersRange.endIndex)
                }
                
                if let endRange = accumulatedData.range(of: self.endData) {
                  accumulatedData.removeSubrange(endRange.startIndex..<endRange.endIndex)
                }
                
                while let endIndex = accumulatedData.range(of: self.closingRangeData) {
                  autoreleasepool {
                    var data = accumulatedData[0..<endIndex.endIndex]
                    
                    if data.prefix(1) == self.commaData {
                      data.remove(at: 0)
                    }
                    
                    if data.prefix(1) != self.openingRangeData && data.suffix(1) != self.closingRangeData {
                      accumulatedData.removeSubrange(0..<endIndex.endIndex)
                    } else {
                      do {
                        if !didParseFiles, let file = try? FileProviderUtils.shared.jsonDecoder.decode(FetchFolderContentsFile.self, from: data) {
                          let processed = try self.processFile(file: file, masterKeys: masterKeys)
                          
                          if (processed.item.name.count > 0) {
                            observer.didEnumerate([processed])
                            
                            didEnumerate = true
                          }
                        } else {
                          if let folder = try? FileProviderUtils.shared.jsonDecoder.decode(FetchFolderContentsFolder.self, from: data) {
                            didParseFiles = true
                            
                            let processed = try self.processFolder(folder: folder, masterKeys: masterKeys)
                            
                            if (processed.item.name.count > 0) {
                              observer.didEnumerate([processed])
                              
                              didEnumerate = true
                            }
                          }
                        }
                      } catch {
                        print("[enumerateItems] error:", error)
                      }
                      
                      accumulatedData.removeSubrange(0..<endIndex.endIndex)
                    }
                  }
                }
              }
            }
          }
        }
        
        if !didEnumerate {
          observer.didEnumerate([])
        }
        
        observer.finishEnumerating(upTo: nil)
      } catch {
        print("[enumerateItems] error:", error)
        
        observer.finishEnumeratingWithError(error)
      }
    }
  }
}

enum FetchFolderContentJSONParseState {
  case lookingForData
  case parsingData
}
