/**
 * Copyright (c) 2014-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule FluxContainer
 * @flow
 */

'use strict';

import type FluxStore from 'FluxStore';

const FluxContainerSubscriptions = require('FluxContainerSubscriptions');
const React = require('react');

const invariant = require('invariant');
const shallowEqual = require('shallowEqual');

const {Component} = React;

type Options = {
  pure?: ?boolean,
  withProps?: ?boolean,
};

const DEFAULT_OPTIONS = {
  pure: true,
  withProps: false,
};

/**
 * A FluxContainer is used to subscribe a react component to multiple stores.
 * The stores that are used must be returned from a static `getStores()` method.
 *
 * The component receives information from the stores via state. The state
 * is generated using a static `calculateState()` method that each container
 * must implement. A simple container may look like:
 *
 *   class FooContainer extends Component {
 *     static getStores() {
 *       return [FooStore];
 *     }
 *
 *     static calculateState() {
 *       return {
 *         foo: FooStore.getState(),
 *       };
 *     }
 *
 *     render() {
 *       return <FooView {...this.state} />;
 *     }
 *   }
 *
 *   module.exports = FluxContainer.create(FooContainer);
 *
 * Flux container also supports some other, more advanced use cases. If you need
 * to base your state off of props as well:
 *
 *   class FooContainer extends Component {
 *     ...
 *
 *     static calculateState(prevState, props) {
 *       return {
 *         foo: FooStore.getSpecificFoo(props.id),
 *       };
 *     }
 *
 *     ...
 *   }
 *
 *   module.exports = FluxContainer.create(FooContainer, {withProps: true});
 *
 * Or if your stores are passed through your props:
 *
 *   class FooContainer extends Component {
 *     ...
 *
 *     static getStores(props) {
 *       const {BarStore, FooStore} = props.stores;
 *       return [BarStore, FooStore];
 *     }
 *
 *     statc calculateState(prevState, props) {
 *       const {BarStore, FooStore} = props.stores;
 *       return {
 *         bar: BarStore.getState(),
 *         foo: FooStore.getState(),
 *       };
 *     }
 *
 *     ...
 *   }
 *
 *   module.exports = FluxContainer.create(FooContainer, {withProps: true});
 */
function create<DefaultProps, Props, State>(
  Base: ReactClass<Props>,
  options?: ?Options,
): ReactClass<Props> {
  enforceInterface(Base);

  // Construct the options using default, override with user values as necessary.
  const realOptions = {
    ...DEFAULT_OPTIONS,
    ...(options || {}),
  };

  const getState = (state, maybeProps) => {
    const props = realOptions.withProps ? maybeProps : undefined;
    return Base.calculateState(state, props);
  };

  const getStores = (maybeProps) => {
    const props = realOptions.withProps ? maybeProps : undefined;
    return Base.getStores(props);
  };

  // Build the container class.
  class ContainerClass extends Base {
    _fluxContainerSubscriptions: FluxContainerSubscriptions;

    constructor(props: Props, context: any) {
      super(props, context);
      this._fluxContainerSubscriptions = new FluxContainerSubscriptions();
      this._fluxContainerSubscriptions.setStores(getStores(props));
      this._fluxContainerSubscriptions.addListener(() => {
        this.setState(
          (prevState, currentProps) => getState(prevState, currentProps)
        );
      });
      const calculatedState = getState(undefined, props);
      this.state = {
        ...(this.state || {}),
        ...calculatedState,
      };
    }

    componentWillReceiveProps(nextProps: any, nextContext: any): void {
      if (super.componentWillReceiveProps) {
        super.componentWillReceiveProps(nextProps, nextContext);
      }

      // Don't do anything else if the container is not configured to use props.
      if (!realOptions.withProps) {
        return;
      }

      // Update both stores and state.
      this._fluxContainerSubscriptions.setStores(getStores(nextProps));
      this.setState(prevState => getState(prevState, nextProps));
    }

    componentWillUnmount() {
      if (super.componentWillUnmount) {
        super.componentWillUnmount();
      }

      this._fluxContainerSubscriptions.reset();
    }
  }

  // Make sure we override shouldComponentUpdate only if the pure option is
  // specified. We can't override this above because we don't want to override
  // the default behavior on accident. Super works weird with react ES6 classes.
  const container = realOptions.pure
    ? createPureComponent(ContainerClass)
    : ContainerClass;

  // Update the name of the container before returning
  const componentName = Base.displayName || Base.name;
  container.displayName = 'FluxContainer(' + componentName + ')';
  return container;
}

function createPureComponent<DefaultProps, Props, State>(
  BaseComponent: ReactClass<Props>
): ReactClass<Props> {
  class PureComponent extends BaseComponent {
    shouldComponentUpdate(nextProps: Props, nextState: State): boolean {
      return (
        !shallowEqual(this.props, nextProps) ||
        !shallowEqual(this.state, nextState)
      );
    }
  }
  return PureComponent;
}


function enforceInterface(o: any): void {
  invariant(
    o.getStores,
    'Components that use FluxContainer must implement `static getStores()`'
  );
  invariant(
    o.calculateState,
    'Components that use FluxContainer must implement `static calculateState()`'
  );
}

/**
 * This is a way to connect stores to a functional stateless view. Here's a
 * simple example:
 *
 *   // FooView.js
 *
 *   function FooView(props) {
 *     return <div>{props.value}</div>;
 *   }
 *
 *   module.exports = FooView;
 *
 *
 *   // FooContainer.js
 *
 *   function getStores() {
 *     return [FooStore];
 *   }
 *
 *   function calculateState() {
 *     return {
 *       value: FooStore.getState();
 *     };
 *   }
 *
 *   module.exports = FluxContainer.createFunctional(
 *     FooView,
 *     getStores,
 *     calculateState,
 *   );
 *
 */
function createFunctional<Props, State, A, B>(
  viewFn: (props: State) => React.Element<State>,
  getStores: (props?: ?Props) => Array<FluxStore>,
  calculateState: (prevState?: ?State, props?: ?Props) => State,
  options?: Options,
): ReactClass<Props> {
  class FunctionalContainer extends Component<void, Props, State> {
    state: State;
    static getStores(props?: ?Props): Array<FluxStore> {
      return getStores(props);
    }

    static calculateState(prevState?: ?State, props?: ?Props): State {
      return calculateState(prevState, props);
    }

    render(): React.Element<State> {
      return viewFn(this.state);
    }
  }
  // Update the name of the component before creating the container.
  const viewFnName = viewFn.displayName || viewFn.name || 'FunctionalContainer';
  FunctionalContainer.displayName = viewFnName;
  return create(FunctionalContainer, options);
}

module.exports = {create, createFunctional};
