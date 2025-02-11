import ReactNativeBlobUtil from "react-native-blob-util"
import { Semaphore, getFileExt, randomIdUnsafe, toBlobUtilPathDecode } from "../../helpers"
import { Platform, DeviceEventEmitter } from "react-native"
import { useStore } from "../../state"
import { i18n } from "../../../i18n"
import storage from "../../storage"
import { showToast } from "../../../components/Toasts"
import { addItemToOfflineList, getItemOfflinePath } from "../offline"
import DeviceInfo from "react-native-device-info"
import { clearCacheDirectories } from "../setup/setup"
import { Item } from "../../../types"
import memoryCache from "../../memoryCache"
import * as fs from "../../../lib/fs"
import { isOnline, isWifi } from "../isOnline"
import { MB } from "../../constants"

const downloadSemaphore = new Semaphore(3)
const maxThreads = 32
const downloadThreadsSemaphore = new Semaphore(maxThreads)
const downloadWriteThreadsSemaphore = new Semaphore(256)
const currentDownloads: Record<string, boolean> = {}
const addDownloadMutex = new Semaphore(1)

export interface QueueFileDownload {
	file: Item
	storeOffline?: boolean
	optionalCallback?: Function
	saveToGalleryCallback?: Function
	isOfflineUpdate?: boolean
	isPreview?: boolean
	showNotification?: boolean
}

export const queueFileDownload = async ({
	file,
	storeOffline = false,
	optionalCallback = undefined,
	saveToGalleryCallback = undefined,
	isOfflineUpdate = false,
	isPreview = false,
	showNotification = false
}: QueueFileDownload) => {
	const callOptionalCallback = (...args: any) => {
		if (typeof optionalCallback == "function") {
			optionalCallback(...args)
		}
	}

	if (!(await isOnline())) {
		callOptionalCallback(new Error("device is offline"))

		showToast({ message: i18n(storage.getString("lang"), "deviceOffline") })

		return
	}

	if (typeof saveToGalleryCallback == "function") {
		try {
			const offlinePath = await fs.getDownloadPath({ type: "offline" })

			if ((await fs.stat(getItemOfflinePath(offlinePath, file))).exists) {
				callOptionalCallback(null, getItemOfflinePath(offlinePath, file))

				saveToGalleryCallback(getItemOfflinePath(offlinePath, file))

				return
			}
		} catch (e) {
			console.log(e)
		}
	}

	await addDownloadMutex.acquire()

	if (typeof currentDownloads[file.uuid] !== "undefined") {
		callOptionalCallback(new Error("Already downloading this file"))

		showToast({
			message: i18n(storage.getString("lang"), "alreadyDownloadingFile", true, ["__NAME__"], [file.name])
		})

		addDownloadMutex.release()

		return
	}

	currentDownloads[file.uuid] = true

	addDownloadMutex.release()

	DeviceEventEmitter.emit("download", {
		type: "start",
		data: file
	})

	if (!isPreview) {
		await downloadSemaphore.acquire()
	}

	try {
		var downloadPath = await fs.getDownloadPath({ type: storeOffline ? "offline" : "download" })
	} catch (e) {
		console.error(e)

		callOptionalCallback(new Error("could not get download path"))

		downloadSemaphore.release()

		delete currentDownloads[file.uuid]

		showToast({ message: i18n(storage.getString("lang"), "couldNotGetDownloadPath") })

		return
	}

	if (storage.getBoolean("onlyWifiDownloads") && !(await isWifi())) {
		downloadSemaphore.release()

		delete currentDownloads[file.uuid]

		showToast({ message: i18n(storage.getString("lang"), "onlyWifiDownloads") })

		return
	}

	const filePath = downloadPath + file.name

	downloadFile(file, true, file.chunks)
		.then(async path => {
			delete currentDownloads[file.uuid]

			downloadSemaphore.release()

			if (isPreview) {
				callOptionalCallback(null, path)

				return
			}

			if (typeof saveToGalleryCallback == "function") {
				callOptionalCallback(null, path)

				saveToGalleryCallback(path)

				return
			}

			if (storeOffline) {
				const offlinePath = getItemOfflinePath(downloadPath, file)

				try {
					if ((await fs.stat(offlinePath)).exists) {
						await fs.unlink(offlinePath)
					}
				} catch (e) {
					//console.log(e)
				}

				fs.move(path, offlinePath)
					.then(() => {
						addItemToOfflineList({
							item: file
						})
							.then(() => {
								DeviceEventEmitter.emit("event", {
									type: "mark-item-offline",
									data: {
										uuid: file.uuid,
										value: true
									}
								})

								callOptionalCallback(null, offlinePath)

								console.log(file.name + " download done")
							})
							.catch(err => {
								showToast({ message: err.toString() })

								callOptionalCallback(err)

								console.error(err)
							})
					})
					.catch(err => {
						showToast({ message: err.toString() })

						callOptionalCallback(err)

						console.error(err)
					})
			} else {
				if (Platform.OS == "android") {
					ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
						{
							name: file.name,
							parentFolder: "",
							mimeType: file.mime
						},
						"Download",
						toBlobUtilPathDecode(path)
					)
						.then(() => {
							fs.unlink(path)
								.then(() => {
									if (showNotification || useStore.getState().imagePreviewModalVisible) {
										showToast({
											message: i18n(storage.getString("lang"), "fileDownloaded", true, ["__NAME__"], [file.name])
										})
									}

									callOptionalCallback(null, "")

									console.log(file.name + " download done")
								})
								.catch(err => {
									showToast({ message: err.toString() })

									callOptionalCallback(err)

									console.error(err)
								})
						})
						.catch(err => {
							showToast({ message: err.toString() })

							callOptionalCallback(err)

							console.error(err)
						})
				} else {
					try {
						if ((await fs.stat(filePath)).exists) {
							await fs.unlink(filePath)
						}
					} catch (e) {
						//console.log(e)
					}

					fs.move(path, filePath)
						.then(() => {
							if (showNotification || useStore.getState().imagePreviewModalVisible) {
								showToast({
									message: i18n(storage.getString("lang"), "fileDownloaded", true, ["__NAME__"], [file.name])
								})
							}

							callOptionalCallback(null, filePath)

							console.log(file.name + " download done")
						})
						.catch(err => {
							showToast({ message: err.toString() })

							callOptionalCallback(err)

							console.error(err)
						})
				}
			}
		})
		.catch(err => {
			downloadSemaphore.release()

			delete currentDownloads[file.uuid]

			if (err.toString() !== "stopped") {
				//showToast({ message: err.toString() })

				DeviceEventEmitter.emit("download", {
					type: "err",
					data: file,
					err: err.toString()
				})

				console.error(err)
			}

			callOptionalCallback(err)
		})
}

export const downloadFile = (file: Item, showProgress: boolean = true, maxChunks: number): Promise<string> => {
	memoryCache.set("showDownloadProgress:" + file.uuid, showProgress)

	return new Promise((resolve, reject) => {
		fs.getDownloadPath({ type: "cachedDownloads" })
			.then(async cachedDownloadsPath => {
				try {
					if ((await DeviceInfo.getFreeDiskStorage()) < MB * 256 + file.size) {
						// We keep a 256 MB buffer in case previous downloads are still being written to the FS
						await clearCacheDirectories()

						await new Promise(resolve => setTimeout(() => resolve(true), 5000))

						if ((await DeviceInfo.getFreeDiskStorage()) < MB * 256 + file.size) {
							// We keep a 256 MB buffer in case previous downloads are still being written to the FS
							return reject(i18n(storage.getString("lang"), "deviceOutOfStorage"))
						}
					}
				} catch (e) {
					return reject(e)
				}

				if (showProgress) {
					DeviceEventEmitter.emit("download", {
						type: "start",
						data: file
					})
				}

				const tmpPath = fs.cacheDirectory().split("file://").join("") + randomIdUnsafe() + file.uuid + "." + getFileExt(file.name)
				let currentWriteIndex = 0
				let didStop = false
				let paused = false
				let stopped = false

				const stopInterval = setInterval(() => {
					if (stopped && !didStop) {
						didStop = true

						clearInterval(stopInterval)
					}
				}, 250)

				const pauseListener = DeviceEventEmitter.addListener("pauseTransfer", uuid => {
					if (uuid == file.uuid) {
						paused = true
					}
				})

				const resumeListener = DeviceEventEmitter.addListener("resumeTransfer", uuid => {
					if (uuid == file.uuid) {
						paused = false
					}
				})

				const stopListener = DeviceEventEmitter.addListener("stopTransfer", uuid => {
					if (uuid == file.uuid) {
						stopped = true
					}
				})

				const cleanup = () => {
					clearInterval(stopInterval)

					stopListener.remove()
					pauseListener.remove()
					resumeListener.remove()
				}

				const downloadTask = (index: number): Promise<{ index: number; path: string }> => {
					return new Promise(async (resolve, reject) => {
						if (paused) {
							await new Promise(resolve => {
								const wait = setInterval(() => {
									if (!paused || stopped) {
										clearInterval(wait)

										return resolve(true)
									}
								}, 250)
							})
						}

						if (didStop) {
							return reject("stopped")
						}

						const destPath =
							fs.cacheDirectory().split("file://").join("") + randomIdUnsafe() + "." + file.uuid + ".chunk." + index

						global.nodeThread
							.downloadDecryptAndWriteFileChunk({
								destPath,
								uuid: file.uuid,
								region: file.region,
								bucket: file.bucket,
								index,
								key: file.key,
								version: file.version
							})
							.then(() => {
								return resolve({
									index,
									path: destPath
								})
							})
							.catch(reject)
					})
				}

				const write = (index: number, path: string) => {
					if (index !== currentWriteIndex) {
						return setTimeout(() => {
							write(index, path)
						}, 10)
					}

					if (index == 0) {
						fs.move(path, tmpPath)
							.then(() => {
								currentWriteIndex += 1

								downloadWriteThreadsSemaphore.release()
							})
							.catch(reject)
					} else {
						global.nodeThread
							.appendFileToFile({
								first: tmpPath,
								second: path
							})
							.then(() => {
								currentWriteIndex += 1

								downloadWriteThreadsSemaphore.release()
							})
							.catch(reject)
					}
				}

				if (showProgress) {
					DeviceEventEmitter.emit("download", {
						type: "started",
						data: file
					})
				}

				const chunksToDownload: number = maxChunks

				try {
					await new Promise((resolve, reject) => {
						let done = 0

						for (let i = 0; i < chunksToDownload; i++) {
							Promise.all([downloadThreadsSemaphore.acquire(), downloadWriteThreadsSemaphore.acquire()]).then(() => {
								downloadTask(i)
									.then(({ index, path }) => {
										write(index, path)

										done += 1

										downloadThreadsSemaphore.release()

										if (done >= chunksToDownload) {
											return resolve(true)
										}
									})
									.catch(err => {
										downloadThreadsSemaphore.release()
										downloadWriteThreadsSemaphore.release()

										return reject(err)
									})
							})
						}
					})

					await new Promise(resolve => {
						if (currentWriteIndex >= chunksToDownload) {
							return resolve(true)
						}

						const wait = setInterval(() => {
							if (currentWriteIndex >= chunksToDownload) {
								clearInterval(wait)

								return resolve(true)
							}
						}, 100)
					})
				} catch (e: any) {
					cleanup()

					if (showProgress) {
						DeviceEventEmitter.emit("download", {
							type: "err",
							err: e.toString(),
							data: file
						})
					}

					return reject(e)
				}

				if (showProgress) {
					DeviceEventEmitter.emit("download", {
						type: "done",
						data: file
					})
				}

				cleanup()

				return resolve(tmpPath)
			})
			.catch(reject)
	})
}
