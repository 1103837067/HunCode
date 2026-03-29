declare module "@vscode/webview-ui-toolkit/react" {
	import * as React from "react";

	type CommonProps = {
		children?: React.ReactNode;
		className?: string;
		style?: React.CSSProperties;
		[key: string]: unknown;
	};

	export const VSCodeButton: React.FC<
		CommonProps & {
			appearance?: string;
			disabled?: boolean;
			type?: "button" | "submit" | "reset";
			onClick?: React.MouseEventHandler<HTMLElement>;
		}
	>;

	export const VSCodeDropdown: React.FC<
		CommonProps & {
			value?: string;
			disabled?: boolean;
			onChange?: (event: Event | React.SyntheticEvent<HTMLElement>) => void;
		}
	>;

	export const VSCodeOption: React.FC<
		CommonProps & {
			value?: string;
			selected?: boolean;
			disabled?: boolean;
		}
	>;

	export const VSCodeTextArea: React.FC<
		CommonProps & {
			value?: string;
			rows?: number;
			placeholder?: string;
			disabled?: boolean;
			onInput?: (event: Event | React.SyntheticEvent<HTMLElement>) => void;
			onChange?: (event: Event | React.SyntheticEvent<HTMLElement>) => void;
			onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
		}
	>;

	export const VSCodeDivider: React.FC<CommonProps>;
	export const VSCodeTag: React.FC<CommonProps>;
	export const VSCodeCheckbox: React.FC<
		CommonProps & {
			checked?: boolean;
			disabled?: boolean;
			onChange?: (event: Event | React.SyntheticEvent<HTMLElement>) => void;
		}
	>;
}
