import React, { useEffect, useState, memo, useCallback } from "react"
import { View, DeviceEventEmitter, Platform } from "react-native"
import ActionSheet, { SheetManager } from "react-native-actions-sheet"
import useLang from "../../../lib/hooks/useLang"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useStore } from "../../../lib/state"
import { getAvailableFolderColors } from "../../../lib/helpers"
import { showToast } from "../../Toasts"
import { i18n } from "../../../i18n"
import { getColor } from "../../../style/colors"
import { ActionButton, ActionSheetIndicator, ItemActionSheetItemHeader } from "../ActionSheets"
import { changeFolderColor } from "../../../lib/api"
import useDarkMode from "../../../lib/hooks/useDarkMode"
import { Item } from "../../../types"

const FolderColorActionSheet = memo(() => {
	const darkMode = useDarkMode()
	const insets = useSafeAreaInsets()
	const lang = useLang()
	const [currentItem, setCurrentItem] = useState<Item | undefined>(undefined)
	const [buttonsDisabled, setButtonsDisabled] = useState<boolean>(false)
	const availableFolderColors = getAvailableFolderColors()

	const changeColor = useCallback(
		async (color: string) => {
			if (typeof currentItem == "undefined") {
				return
			}

			if (buttonsDisabled) {
				return
			}

			setButtonsDisabled(true)

			await SheetManager.hide("FolderColorActionSheet")

			useStore.setState({ fullscreenLoadingModalVisible: true })

			changeFolderColor(currentItem.uuid, color)
				.then(async () => {
					DeviceEventEmitter.emit("event", {
						type: "change-folder-color",
						data: {
							uuid: currentItem.uuid,
							color
						}
					})

					setButtonsDisabled(false)

					useStore.setState({ fullscreenLoadingModalVisible: false })

					showToast({
						message: i18n(
							lang,
							"folderColorChanged",
							true,
							["__NAME__", "__COLOR__"],
							[currentItem.name, i18n(lang, "color_" + color)]
						)
					})
				})
				.catch(err => {
					console.error(err)

					setButtonsDisabled(false)

					useStore.setState({ fullscreenLoadingModalVisible: false })

					showToast({ message: err.toString() })
				})
		},
		[buttonsDisabled, currentItem, lang]
	)

	useEffect(() => {
		const openFolderColorActionSheetListener = DeviceEventEmitter.addListener("openFolderColorActionSheet", (item: Item) => {
			setCurrentItem(item)

			SheetManager.show("FolderColorActionSheet")
		})

		return () => {
			openFolderColorActionSheetListener.remove()
		}
	}, [])

	return (
		// @ts-ignore
		<ActionSheet
			id="FolderColorActionSheet"
			gestureEnabled={true}
			containerStyle={{
				backgroundColor: getColor(darkMode, "backgroundSecondary"),
				borderTopLeftRadius: 15,
				borderTopRightRadius: 15
			}}
			indicatorStyle={{
				display: "none"
			}}
		>
			<View
				style={{
					paddingBottom: insets.bottom + (Platform.OS === "android" ? 25 : 5)
				}}
			>
				<ActionSheetIndicator />
				<ItemActionSheetItemHeader />
				{Object.keys(availableFolderColors).map(prop => {
					if (prop == "default_ios") {
						return null
					}

					if (typeof currentItem == "undefined") {
						return null
					}

					return (
						<ActionButton
							key={prop}
							onPress={() => changeColor(prop)}
							color={
								prop == "default"
									? (availableFolderColors["default_ios"] as string)
									: (availableFolderColors[prop] as string)
							}
							text={i18n(lang, "color_" + prop)}
						/>
					)
				})}
			</View>
		</ActionSheet>
	)
})

export default FolderColorActionSheet
