<template>
  <control-wrapper
    v-bind="controlWrapper"
    :styles="styles"
    :is-focused="isFocused"
    :applied-options="appliedOptions"
  >
    <select
      :id="control.id + '-input'"
      :class="styles.control.select"
      :value="control.data"
      :disabled="!control.enabled"
      :autofocus="appliedOptions.focus"
      @change="onChange"
      @focus="isFocused = true"
      @blur="isFocused = false"
    >
      <option key="empty" value="" :class="styles.control.option" />
      <option
        v-for="optionElement in control.options"
        :key="String(optionElement.value)"
        :value="optionElement.value"
        :label="optionElement.label"
        :class="styles.control.option"
      ></option>
    </select>
  </control-wrapper>
</template>

<script lang="ts">
import { rankWith, isOneOfEnumControl } from '@jsonforms/core';
import type { ControlElement, JsonFormsRendererRegistryEntry } from '@jsonforms/core';
import { defineComponent } from 'vue';
import { rendererProps, useJsonFormsOneOfEnumControl } from '@jsonforms/vue';
import type { RendererProps } from '@jsonforms/vue';
import { ControlWrapper, useVanillaControl } from '@jsonforms/vue-vanilla';

/**
 * The oneOf-enum twin of TypedEnumControlRenderer: vanilla's renderer emits
 * the <select>'s DOM string, mangling numeric/boolean const values. This copy
 * maps the chosen string back to the original oneOf const.
 */
const controlRenderer = defineComponent({
  name: 'TypedOneOfEnumControlRenderer',
  components: {
    ControlWrapper,
  },
  props: {
    ...rendererProps<ControlElement>(),
  },
  setup(props: RendererProps<ControlElement>) {
    const enumControl = useJsonFormsOneOfEnumControl(props);
    const { control } = enumControl;
    return useVanillaControl(enumControl, (target: HTMLSelectElement) => {
      if (target.selectedIndex === 0) return undefined;
      const chosen = control.value.options?.find(
        (o) => String(o.value) === target.value,
      );
      return chosen ? chosen.value : target.value;
    });
  },
});

export default controlRenderer;

export const entry: JsonFormsRendererRegistryEntry = {
  renderer: controlRenderer,
  tester: rankWith(6, isOneOfEnumControl),
};
</script>
